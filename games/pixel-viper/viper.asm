; ===========================================================================
;  PIXEL VIPER - an original NES game, MIT licensed (c) 2026 Jimmy Kurc
;
;  A snake game on a 16x15 grid of 16x16-pixel cells (NROM-128, CHR ROM).
;  Graphics are background tiles only: every cell is a 2x2-tile "metatile",
;  and the main loop queues nametable updates that the NMI handler copies
;  to the PPU during vblank.
;
;  Build: node tools/build-games.js
; ===========================================================================

PPUCTRL   = $2000
PPUMASK   = $2001
PPUSTATUS = $2002
PPUSCROLL = $2005
PPUADDR   = $2006
PPUDATA   = $2007

; metatiles (the value stored in the cell map, tile = id * 4)
EMPTY = 0
WALL  = 1
BODY  = 2
HEAD  = 3
FOOD  = 4

; controller bits after read_pad
PAD_A      = $80
PAD_START  = $10
PAD_UP     = $08
PAD_DOWN   = $04
PAD_LEFT   = $02
PAD_RIGHT  = $01

; zero page
frame     = $00
nmi_ready = $01
qptr      = $02
pad       = $03
padprev   = $04
padnew    = $05
state     = $06       ; 0 title, 1 playing, 2 game over
dir       = $07       ; 0 up, 1 right, 2 down, 3 left
nextdir   = $08
hidx      = $09       ; ring index of the head
tidx      = $0A       ; ring index of the tail
grow      = $0B
timer     = $0C
speed     = $0D       ; frames per step
seed      = $0E
tmp       = $0F
cell      = $10
ptrlo     = $11
ptrhi     = $12
score     = $13       ; 3 decimal digits, hundreds first
best      = $16       ; 3 decimal digits
addrlo    = $19
addrhi    = $1A
eaten     = $1B
mask      = $1C
oldhead   = $1D
needfood  = $1E
trow      = $1F
tcol      = $20

RING   = $0300        ; cell index of every snake segment (256-entry ring)
MAP    = $0500        ; one byte per cell: metatile id (0 = free)
QUEUE  = $0600        ; NMI update queue: hi, lo, len, data... ; 0 ends
DIGBUF = $0700

  .org $C000

; ---------------------------------------------------------------- reset ----
reset:
  sei
  cld
  ldx #$40
  stx $4017           ; no APU frame IRQ
  ldx #$FF
  txs
  inx
  stx PPUCTRL
  stx PPUMASK
  stx $4010
  bit PPUSTATUS
@vb1:
  bit PPUSTATUS
  bpl @vb1
@clr:
  lda #0
  sta $0000,x
  sta $0100,x
  sta $0300,x
  sta $0400,x
  sta $0500,x
  sta $0600,x
  sta $0700,x
  lda #$FF
  sta $0200,x
  inx
  bne @clr
@vb2:
  bit PPUSTATUS
  bpl @vb2

  lda PPUSTATUS       ; palette
  lda #$3F
  sta PPUADDR
  lda #$00
  sta PPUADDR
  ldx #0
@pal:
  lda palette,x
  sta PPUDATA
  inx
  cpx #32
  bne @pal

  lda #$0F
  sta $4015           ; pulse 1, pulse 2, triangle, noise
  lda #$A7
  sta seed
  jsr enter_title

main:
  jsr wait_frame
  lda #0
  sta qptr
  jsr read_pad
  jsr update
  ldx qptr
  lda #0
  sta QUEUE,x
  lda #1
  sta nmi_ready
  jmp main

wait_frame:
  lda frame
@w:
  cmp frame
  beq @w
  rts

; ------------------------------------------------------------------ NMI ----
nmi:
  pha
  txa
  pha
  tya
  pha
  bit PPUSTATUS
  lda nmi_ready
  beq @skip
  ldx #0
@q:
  lda QUEUE,x
  beq @done
  sta PPUADDR
  lda QUEUE+1,x
  sta PPUADDR
  ldy QUEUE+2,x
  inx
  inx
  inx
@b:
  lda QUEUE,x
  sta PPUDATA
  inx
  dey
  bne @b
  jmp @q
@done:
  lda #0
  sta nmi_ready
@skip:
  lda #0
  sta PPUSCROLL
  sta PPUSCROLL
  lda #$80
  sta PPUCTRL
  lda mask
  sta PPUMASK
  inc frame
  pla
  tay
  pla
  tax
  pla
irq:
  rti

; ---------------------------------------------------------------- input ----
read_pad:
  lda pad
  sta padprev
  lda #1
  sta $4016
  lda #0
  sta $4016
  ldx #8
@l:
  lda $4016
  lsr a
  rol pad
  dex
  bne @l
  lda padprev
  eor #$FF
  and pad
  sta padnew
  rts

; 8-bit Galois LFSR, period 255
rnd:
  lda seed
  asl a
  bcc @n
  eor #$1D
@n:
  sta seed
  rts

; ---------------------------------------------------------------- states ----
update:
  lda state
  beq @title
  cmp #1
  beq @play
  lda padnew          ; game over: A or Start plays again
  and #PAD_A|PAD_START
  beq @r
  jmp start_game
@title:
  jsr rnd             ; the wait on the title seeds the food positions
  lda padnew
  and #PAD_A|PAD_START
  beq @r
  jmp start_game
@play:
  jmp play_update
@r:
  rts

enter_title:
  jsr render_off
  jsr build_map
  jsr draw_board
  ldy #M_TITLE
  jsr print_msg
  ldy #M_PRESS
  jsr print_msg
  ldy #M_CREDIT
  jsr print_msg
  ldy #M_BEST
  jsr print_msg
  jsr best_direct
  lda #0
  sta state
  jmp render_on

start_game:
  jsr render_off
  jsr build_map
  lda #$83            ; three segments on row 8, heading right
  sta RING
  lda #$84
  sta RING+1
  lda #$85
  sta RING+2
  lda #0
  sta tidx
  lda #2
  sta hidx
  lda #BODY
  sta MAP+$83
  sta MAP+$84
  lda #HEAD
  sta MAP+$85
  lda #1
  sta dir
  sta nextdir
  lda #0
  sta score
  sta score+1
  sta score+2
  sta grow
  sta eaten
  sta needfood
  lda #8
  sta speed
  sta timer
  jsr place_food
  jsr draw_board
  ldy #M_SCORE
  jsr print_msg
  ldy #M_BEST
  jsr print_msg
  jsr score_direct
  jsr best_direct
  lda #0
  sta qptr
  lda #1
  sta state
  jmp render_on

play_update:
  lda pad
  and #PAD_UP
  beq @n0
  ldy #0
  jsr try_dir
@n0:
  lda pad
  and #PAD_RIGHT
  beq @n1
  ldy #1
  jsr try_dir
@n1:
  lda pad
  and #PAD_DOWN
  beq @n2
  ldy #2
  jsr try_dir
@n2:
  lda pad
  and #PAD_LEFT
  beq @n3
  ldy #3
  jsr try_dir
@n3:
  dec timer
  bne @r
  lda speed
  sta timer
  jmp step
@r:
  rts

; Y = wanted direction; a U-turn is ignored
try_dir:
  tya
  clc
  adc #2
  and #3
  cmp dir
  beq @x
  sty nextdir
@x:
  rts

; One snake step.
step:
  lda nextdir
  sta dir
  ldx hidx
  lda RING,x
  sta oldhead
  ldy dir
  clc
  adc delta,y
  sta cell
  tax
  lda MAP,x
  beq @move
  cmp #FOOD
  beq @eat
  jmp die
@eat:
  jsr inc_score
  jsr score_queue
  lda grow
  clc
  adc #3
  sta grow
  jsr beep
  lda #1
  sta needfood
  inc eaten
  lda eaten
  cmp #4
  bcc @move
  lda #0
  sta eaten
  lda speed
  cmp #4
  bcc @move
  dec speed
@move:
  lda cell            ; the old head becomes body
  pha
  lda oldhead
  sta cell
  ldx cell
  lda #BODY
  sta MAP,x
  jsr queue_meta
  pla
  sta cell
  inc hidx            ; new head
  ldx hidx
  lda cell
  sta RING,x
  ldx cell
  lda #HEAD
  sta MAP,x
  jsr queue_meta
  lda grow            ; the tail follows unless growing
  beq @tail
  dec grow
  jmp @food
@tail:
  ldx tidx
  lda RING,x
  sta cell
  tax
  lda #EMPTY
  sta MAP,x
  jsr queue_meta
  inc tidx
@food:
  lda needfood
  beq @x
  lda #0
  sta needfood
  jmp place_food
@x:
  rts

die:
  jsr crash
  ldx #0              ; new best score?
@c:
  lda score,x
  cmp best,x
  bcc @show
  bne @copy
  inx
  cpx #3
  bne @c
  beq @show
@copy:
  lda score
  sta best
  lda score+1
  sta best+1
  lda score+2
  sta best+2
@show:
  ldy #M_OVER
  jsr queue_msg
  ldy #M_AGAIN
  jsr queue_msg
  jsr best_queue
  lda #2
  sta state
  rts

place_food:
@t:
  jsr rnd
  tax
  lda MAP,x
  bne @t
  lda #FOOD
  sta MAP,x
  stx cell
  jmp queue_meta

inc_score:
  ldx #2
@l:
  inc score,x
  lda score,x
  cmp #10
  bcc @d
  lda #0
  sta score,x
  dex
  bpl @l
@d:
  rts

; ----------------------------------------------------------------- sound ----
beep:
  lda #$83            ; 50% duty, envelope decay
  sta $4000
  lda #$08            ; sweep off
  sta $4001
  lda #$A9
  sta $4002
  lda #$08
  sta $4003
  rts

crash:
  lda #$0C
  sta $400C
  lda #$0C
  sta $400E
  lda #$08
  sta $400F
  rts

; --------------------------------------------------------------- the map ----
; Walls around the playfield (cell rows 2-14, columns 0-15); rows 0-1 hold
; the score and are not playable, nor is the off-screen row 15.
build_map:
  ldx #0
@m:
  txa
  and #$0F
  beq @wall
  cmp #$0F
  beq @wall
  txa
  cmp #$30
  bcc @wall
  cmp #$E0
  bcs @wall
  lda #EMPTY
  beq @st
@wall:
  lda #WALL
@st:
  sta MAP,x
  inx
  bne @m
  rts

; Draw the whole nametable from the map (rendering must be off).
draw_board:
  lda PPUSTATUS
  lda #$20
  sta PPUADDR
  lda #$00
  sta PPUADDR
  lda #0
  sta trow
@row:
  lda #0
  sta tcol
@col:
  lda trow
  lsr a
  cmp #2
  bcc @blank          ; score rows
  asl a
  asl a
  asl a
  asl a
  sta tmp
  lda tcol
  lsr a
  ora tmp
  tax
  lda MAP,x
  asl a
  asl a
  sta tmp
  lda trow
  and #1
  asl a
  ora tmp
  sta tmp
  lda tcol
  and #1
  ora tmp
  jmp @put
@blank:
  lda #0
@put:
  sta PPUDATA
  inc tcol
  lda tcol
  cmp #32
  bne @col
  inc trow
  lda trow
  cmp #30
  bne @row
  ldx #64             ; attribute table: palette 0 everywhere
  lda #0
@at:
  sta PPUDATA
  dex
  bne @at
  rts

render_off:
  lda #0
  sta PPUCTRL
  sta PPUMASK
  sta mask
  rts

render_on:
  lda #$0A            ; show the background, including the left 8 pixels
  sta mask
  lda #0
  sta PPUSCROLL
  sta PPUSCROLL
  lda #$80
  sta PPUCTRL
  rts

; -------------------------------------------------------- update queue ----
; A = metatile, cell = cell index. Queues the 2x2 tiles of that cell.
queue_meta:
  asl a
  asl a
  sta tmp
  lda cell            ; address = $2000 + row*64 + col*2
  and #$F0
  sta addrlo
  lda #0
  sta addrhi
  asl addrlo
  rol addrhi
  asl addrlo
  rol addrhi
  lda cell
  and #$0F
  asl a
  ora addrlo
  sta addrlo
  lda addrhi
  ora #$20
  sta addrhi
  ldx qptr
  sta QUEUE,x
  inx
  lda addrlo
  sta QUEUE,x
  inx
  lda #2
  sta QUEUE,x
  inx
  lda tmp
  sta QUEUE,x
  inx
  clc
  adc #1
  sta QUEUE,x
  inx
  lda addrlo          ; second row of tiles, 32 bytes further
  clc
  adc #32
  sta addrlo
  lda addrhi
  adc #0
  sta QUEUE,x
  inx
  lda addrlo
  sta QUEUE,x
  inx
  lda #2
  sta QUEUE,x
  inx
  lda tmp
  clc
  adc #2
  sta QUEUE,x
  inx
  clc
  adc #1
  sta QUEUE,x
  inx
  stx qptr
  rts

; ------------------------------------------------------------------ text ----
; A = tile row, X = tile column -> addrhi/addrlo
set_addr:
  sta addrlo
  lda #0
  sta addrhi
  asl addrlo
  rol addrhi
  asl addrlo
  rol addrhi
  asl addrlo
  rol addrhi
  asl addrlo
  rol addrhi
  asl addrlo
  rol addrhi
  txa
  ora addrlo
  sta addrlo
  lda addrhi
  ora #$20
  sta addrhi
  rts

; Y = message offset in msgs -> pointer and address
msg_setup:
  lda msgs+2,y
  sta ptrlo
  lda msgs+3,y
  sta ptrhi
  ldx msgs+1,y
  lda msgs,y
  jmp set_addr

print_msg:
  jsr msg_setup
  jmp print_direct

queue_msg:
  jsr msg_setup
  jmp queue_text

; Zero-terminated string at (ptr) straight to the PPU (rendering off).
print_direct:
  lda PPUSTATUS
  lda addrhi
  sta PPUADDR
  lda addrlo
  sta PPUADDR
  ldy #0
@l:
  lda (ptrlo),y
  beq @d
  sta PPUDATA
  iny
  bne @l
@d:
  rts

; Same, through the NMI queue.
queue_text:
  ldx qptr
  lda addrhi
  sta QUEUE,x
  inx
  lda addrlo
  sta QUEUE,x
  inx
  stx tmp             ; where the length goes
  inx
  ldy #0
@l:
  lda (ptrlo),y
  beq @d
  sta QUEUE,x
  inx
  iny
  bne @l
@d:
  tya
  ldy tmp
  sta QUEUE,y
  stx qptr
  rts

; X = zero-page address of 3 digits -> DIGBUF string, ptr set
fmt_digits:
  lda 0,x
  ora #$30
  sta DIGBUF
  lda 1,x
  ora #$30
  sta DIGBUF+1
  lda 2,x
  ora #$30
  sta DIGBUF+2
  lda #0
  sta DIGBUF+3
  lda #<DIGBUF
  sta ptrlo
  lda #>DIGBUF
  sta ptrhi
  rts

score_direct:
  ldx #score
  jsr fmt_digits
  lda #2
  ldx #8
  jsr set_addr
  jmp print_direct

score_queue:
  ldx #score
  jsr fmt_digits
  lda #2
  ldx #8
  jsr set_addr
  jmp queue_text

best_direct:
  ldx #best
  jsr fmt_digits
  lda #2
  ldx #26
  jsr set_addr
  jmp print_direct

best_queue:
  ldx #best
  jsr fmt_digits
  lda #2
  ldx #26
  jsr set_addr
  jmp queue_text

; ------------------------------------------------------------------ data ----
delta:
  .byte -16, 1, 16, -1

palette:
  .byte $0F,$2A,$16,$2C, $0F,$2A,$16,$2C, $0F,$2A,$16,$2C, $0F,$2A,$16,$2C
  .byte $0F,$2A,$16,$2C, $0F,$2A,$16,$2C, $0F,$2A,$16,$2C, $0F,$2A,$16,$2C

M_TITLE  = 0
M_PRESS  = 4
M_CREDIT = 8
M_SCORE  = 12
M_BEST   = 16
M_OVER   = 20
M_AGAIN  = 24
msgs:
  .byte 9, 10
  .word s_title
  .byte 16, 10
  .word s_press
  .byte 24, 6
  .word s_credit
  .byte 2, 2
  .word s_score
  .byte 2, 21
  .word s_best
  .byte 13, 11
  .word s_over
  .byte 16, 10
  .word s_press

s_title:  .asciiz "PIXEL VIPER"
s_press:  .asciiz "PRESS START"
s_credit: .asciiz "2026 JIMMY KURC - MIT"
s_score:  .asciiz "SCORE"
s_best:   .asciiz "BEST"
s_over:   .asciiz "GAME OVER"

  .org $FFFA
  .word nmi, reset, irq

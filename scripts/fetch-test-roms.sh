#!/bin/sh
# Downloads public NES test ROMs (blargg, kevtris' nestest, ...) into
# test-roms/ for local testing. They are NOT redistributed by this repository.
# Source mirror: https://github.com/christopherpow/nes-test-roms
set -e
cd "$(dirname "$0")/.."
mkdir -p test-roms
cd test-roms
BASE=https://raw.githubusercontent.com/christopherpow/nes-test-roms/master
for f in \
  other/nestest.nes other/nestest.log \
  instr_test-v5/official_only.nes instr_test-v5/all_instrs.nes \
  instr_timing/instr_timing.nes cpu_timing_test6/cpu_timing_test.nes \
  cpu_dummy_reads/cpu_dummy_reads.nes branch_timing_tests/1.Branch_Basics.nes \
  ppu_vbl_nmi/ppu_vbl_nmi.nes apu_test/apu_test.nes \
  sprite_hit_tests_2005.10.05/01.basics.nes sprite_hit_tests_2005.10.05/02.alignment.nes \
  sprite_hit_tests_2005.10.05/03.corners.nes sprite_hit_tests_2005.10.05/04.flip.nes \
  sprite_hit_tests_2005.10.05/05.left_clip.nes sprite_hit_tests_2005.10.05/06.right_edge.nes \
  sprite_hit_tests_2005.10.05/07.screen_bottom.nes sprite_hit_tests_2005.10.05/08.double_height.nes \
  sprite_hit_tests_2005.10.05/09.timing_basics.nes sprite_hit_tests_2005.10.05/10.timing_order.nes \
  sprite_hit_tests_2005.10.05/11.edge_timing.nes \
  mmc3_test_2/rom_singles/1-clocking.nes mmc3_test_2/rom_singles/2-details.nes \
  mmc3_test_2/rom_singles/3-A12_clocking.nes mmc3_test_2/rom_singles/4-scanline_timing.nes \
  mmc3_test_2/rom_singles/5-MMC3.nes
do
  echo "fetching $f"
  curl -sfLO "$BASE/$f"
done
echo "done: $(ls | wc -l | tr -d ' ') files in test-roms/"

/*
 * P0-FX1 known-bad-oam fixture.
 *
 * Identical to fixtures/known-good, plus one deliberate class-A violation
 * (docs/verify-taxonomy.md): a raw 8-bit store to the OAM region, bypassing
 * Butano's safe API. OAM only accepts 16/32-bit access; an 8-bit store is
 * dropped/mirrored by hardware and corrupts adjacent OAM data. This must
 * still compile and run -- it's a runtime bug, not a compile error.
 *
 * Expected verify_rom result: FAIL, with a class-A OAM gameError line.
 */

#include "bn_core.h"
#include "bn_regular_bg_ptr.h"
#include "bn_regular_bg_items_red.h"

#include <cstdint>

int main()
{
    bn::core::init();

    bn::regular_bg_ptr bg = bn::regular_bg_items::red.create_bg(0, 0);

    while(true)
    {
        // Deliberate class-A violation: narrow (8-bit) write to OAM (0x07000000).
        *(volatile uint8_t*)0x07000000 = 0x42;

        bn::core::update();
    }
}

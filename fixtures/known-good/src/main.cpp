/*
 * P0-FX1 known-good fixture.
 *
 * Minimal Butano project: one regular background on screen, running forever.
 * Uses only Butano's safe API (bn::regular_bg_ptr) -- no raw hardware writes.
 * Expected verify_rom result: PASS (zero ERROR/FATAL lines, sane CPU state).
 */

#include "bn_core.h"
#include "bn_regular_bg_ptr.h"
#include "bn_regular_bg_items_red.h"

int main()
{
    bn::core::init();

    bn::regular_bg_ptr bg = bn::regular_bg_items::red.create_bg(0, 0);

    while(true)
    {
        bn::core::update();
    }
}

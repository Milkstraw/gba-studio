#!/usr/bin/env python3
"""screenshot_rom — capture headless libmgba framebuffer PNGs (P0-L1 seam).

Runs a compiled `.gba` in headless libmgba and captures the framebuffer at
one or more frame numbers as PNGs (via libmgba's own PNG writer — no extra
image-library dependency). Output matches the `ScreenshotResult` shape in
`@gba-studio/contract`: `{"images": [{"frame": N, "pngBase64": "..."}]}`.

Usage:
    python3 screenshot_rom.py <rom.gba> --frames 60 120 [--json]
Exit: 0 = ok, 2 = infra error (bad args / load failure).
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import sys


class _ReadableAfterClose(io.BytesIO):
    """libmgba's PNG writer calls .close() on the fileobj it's handed (via its
    VFile-from-Python wrapper) once it's done writing. Keep the buffer alive
    so save_png()'s caller can still read the bytes out afterwards."""

    def close(self) -> None:
        pass


def capture(rom_path: str, frames: list[int]) -> dict:
    import mgba.core
    import mgba.image
    import mgba.log

    class _Logger(mgba.log.Logger):
        def log(self, category, level, message):
            pass

    mgba.log.install_default(_Logger())

    core = mgba.core.load_path(rom_path)
    if core is None:
        raise RuntimeError(f"libmgba could not identify/load ROM: {rom_path}")

    width, height = core.desired_video_dimensions()
    image = mgba.image.Image(width, height)
    core.set_video_buffer(image)
    core.reset()

    wanted = sorted(set(frames))
    images: list[dict] = []
    ran = 0
    for frame in wanted:
        while ran < frame:
            core.run_frame()
            ran += 1
        buf = _ReadableAfterClose()
        image.save_png(buf)
        images.append({"frame": frame, "pngBase64": base64.b64encode(buf.getvalue()).decode("ascii")})

    return {"images": images}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rom", help="path to the .gba ROM")
    parser.add_argument("--frames", type=int, nargs="+", required=True, help="frame numbers to capture")
    parser.add_argument("--json", action="store_true", help="emit only the ScreenshotResult JSON")
    args = parser.parse_args(argv)

    try:
        result = capture(args.rom, args.frames)
    except Exception as exc:  # infra failure -> exit 2
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(result))
    else:
        print(f"captured {len(result['images'])} frame(s)")
        print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())

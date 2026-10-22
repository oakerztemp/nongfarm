"""Appends ?v=<version> to every relative asset URL of a built site, so one deploy = one consistent set of files.

Usage: python version_assets.py SITE_DIR VERSION

- js/**/*.js: every quoted relative module path ending in .js ('./x.js', "../y.js") gets ?v=VERSION
  (static imports, dynamic import() and path strings such as the view module list).
- index.html: css/ and js/ hrefs/srcs get ?v=VERSION.
Absolute URLs (CDN imports, fonts) are never touched. Stdlib only; running it twice is a no-op.
"""
import pathlib
import re
import sys

MODULE_SPEC = re.compile(r"""(['"])(\.{1,2}/[^'"?\s]+?\.js)\1""")
HTML_ASSET = re.compile(r"""\b(href|src)="((?:css|js)/[^"?]+)\"""")


def main(site, version):
    root = pathlib.Path(site)
    changed = 0
    for path in sorted(root.glob("js/**/*.js")):
        text = path.read_text(encoding="utf-8")
        new = MODULE_SPEC.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={version}{m.group(1)}", text)
        if new != text:
            path.write_text(new, encoding="utf-8", newline="")
            changed += 1
    index = root / "index.html"
    text = index.read_text(encoding="utf-8")
    new = HTML_ASSET.sub(lambda m: f'{m.group(1)}="{m.group(2)}?v={version}"', text)
    if new != text:
        index.write_text(new, encoding="utf-8", newline="")
        changed += 1
    print(f"versioned {changed} files with ?v={version}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])

#!/usr/bin/env python3
"""Chart Journal's tiny web server: the same as `python3 -m http.server 5173 --bind 127.0.0.1`, but every response carries
Cache-Control: no-store, so the browser can never keep serving an old app.js or styles.css.
Port 5173 is fixed in the PersonalOS registry; if it is taken this stops with a message and never picks another."""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "5173"))
HOST = "127.0.0.1"


class NoStoreHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):   # keep the terminal readable: one short line per request
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    try:
        server = ThreadingHTTPServer((HOST, PORT), NoStoreHandler)
    except OSError as e:
        sys.stderr.write("Chart Journal needs port %d, but something is already using it (%s).\n" % (PORT, e.strerror or e))
        sys.stderr.write("Stop that program (or an older Chart Journal window), then run this again.\n")
        sys.exit(1)
    print("Chart Journal serving http://%s:%d  (Cache-Control: no-store)" % (HOST, PORT), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

import http.server
import os
import socketserver
import sys

# Ensure working directory is demo-site directory
demo_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(demo_dir)

class SafeHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=demo_dir, **kwargs)

    def log_message(self, format, *args):
        # Suppress writing to stdout/stderr in case of headless or closed handles
        try:
            if sys.stdout and not sys.stdout.closed:
                sys.stdout.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), format % args))
        except Exception:
            pass

class SafeServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
    try:
        with SafeServer(("", port), SafeHandler) as httpd:
            httpd.serve_forever()
    except Exception:
        pass

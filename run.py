import argparse

from pianoroll.web.app import create_app


def main():
    parser = argparse.ArgumentParser(description="Piano Practice")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()

    app = create_app()
    app.run(host=args.host, port=args.port, debug=True)


if __name__ == "__main__":
    main()

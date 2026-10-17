# API examples

Five small programs that read a Glasgow Theatre API response from stdin and
print a short table. They are the same files the interactive playground at
<https://glasgowtheatre.com/api/examples.html> runs in a sandbox.

| Language | File | API view |
| --- | --- | --- |
| JavaScript (Node 22) | `javascript/shows.js` | JSON |
| Python 3 | `python/shows.py` | JSON |
| PHP 8 | `php/shows.php` | JSON |
| C (C11) | `c/shows.c` | tab-separated (`format=txt`) |
| Go 1.22 | `go/main.go` | JSON |

## Run them all

```sh
./examples/run.sh
```

Against a local build (serve `dist/` first with `npm run preview`):

```sh
./examples/run.sh http://127.0.0.1:4173/api/v1
```

The script skips a language whose runtime is not installed. C needs a C
compiler (`cc`); Go is optional.

## Run one

Each program expects the API response on stdin, so the fetch is explicit and
the program itself stays simple:

```sh
curl -s 'https://glasgowtheatre.com/api/v1/shows?limit=5' \
  | node examples/javascript/shows.js
```

For C, use the text view:

```sh
cc -O2 -std=c11 -o /tmp/shows examples/c/shows.c
curl -s 'https://glasgowtheatre.com/api/v1/shows-preview.txt' | /tmp/shows
```

## Why stdin?

The browser playground fetches a five-show snapshot from the API and sends it
to Judge0's sandbox as standard input. Judge0 has no network access, so the
program never has to make an HTTP request. Keeping the fetch outside the
program also makes the same file work locally, in a pipe, and in the sandbox
without a mock or a special case.

If you want a program that fetches the API itself, replace the stdin read with
your language's HTTP client:

- Node: `await fetch(url).then((response) => response.text())`
- Python: `urllib.request.urlopen(url).read()`
- PHP: `file_get_contents($url)`
- Go: `http.Get(url)`
- C: libcurl

The API sends `Access-Control-Allow-Origin: *`, so a browser `fetch()` works
too. See <https://glasgowtheatre.com/api/> for the full contract.

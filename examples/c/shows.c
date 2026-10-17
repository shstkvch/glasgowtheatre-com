/*
 * Print the next few Glasgow shows from the tab-separated API view on stdin.
 *
 *   curl -s 'https://glasgowtheatre.com/api/v1/shows-preview.txt' \
 *     | ./examples/c/shows
 *
 * The JSON API is the main interface. This example uses format=txt because a
 * five-line JSON parser would bury the thing the example is meant to show.
 * Compile with:
 *
 *   cc -O2 -std=c11 -o shows examples/c/shows.c
 */
#include <stdio.h>
#include <string.h>

#define MAX_FIELDS 7

int main(void) {
  char line[8192];
  int shown = 0;

  while (fgets(line, sizeof line, stdin)) {
    if (line[0] == '#') continue; /* header */
    line[strcspn(line, "\r\n")] = '\0';

    char *fields[MAX_FIELDS];
    int count = 0;
    char *cursor = line;
    fields[count++] = cursor;
    while (*cursor && count < MAX_FIELDS) {
      if (*cursor == '\t') {
        *cursor = '\0';
        fields[count++] = cursor + 1;
      }
      cursor++;
    }
    if (count < MAX_FIELDS) continue;

    /* opens, closes, title, venue, artForm, fromPrice, url */
    printf("%s  %s\n", fields[0], fields[2]);
    printf("          %s", fields[3]);
    if (fields[4][0]) printf(" - %s", fields[4]);
    if (fields[5][0]) printf(" - from GBP %s", fields[5]);
    printf("\n          %s\n\n", fields[6]);

    if (++shown >= 5) break;
  }

  if (!shown) {
    fprintf(stderr,
            "No TSV input. Pipe the API's text view in, for example:\n"
            "  curl -s 'https://glasgowtheatre.com/api/v1/shows-preview.txt'"
            " | ./shows\n");
    return 1;
  }
  return 0;
}

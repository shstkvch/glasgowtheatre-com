<?php
/**
 * Print the next few Glasgow shows from an API response on stdin.
 *
 *   curl -s 'https://glasgowtheatre.com/api/v1/shows?limit=5' \
 *     | php examples/php/shows.php
 *
 * The interactive version at /api/examples.html runs this same file against a
 * snapshot of five shows, so the sandbox never needs network access.
 */

$raw = stream_get_contents(STDIN);
if ($raw === false || trim($raw) === "") {
    fwrite(
        STDERR,
        "No input. Pipe an API response in, for example:\n" .
            "  curl -s 'https://glasgowtheatre.com/api/v1/shows-preview.json'" .
            " | php shows.php\n"
    );
    exit(1);
}

$feed = json_decode($raw, true);
if (!is_array($feed)) {
    fwrite(STDERR, "That was not JSON: " . json_last_error_msg() . "\n");
    exit(1);
}

$shows = $feed["shows"] ?? [];
$total = $feed["total"] ?? count($shows);
printf("%d upcoming shows (showing %d)\n\n", $total, min(count($shows), 5));

foreach (array_slice($shows, 0, 5) as $show) {
    $from = $show["pricing"]["from"] ?? null;
    $price = $from !== null ? "from £" . $from : "price at venue";
    printf(
        "%s  %s\n          %s · %s · %s\n          %s\n\n",
        $show["run"]["opens"],
        $show["title"],
        $show["venue"]["name"],
        $show["artForm"],
        $price,
        $show["url"]
    );
}

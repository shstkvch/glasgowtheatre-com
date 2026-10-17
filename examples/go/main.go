// Print the next few Glasgow shows from an API response on stdin.
//
//	curl -s 'https://glasgowtheatre.com/api/v1/shows?limit=5' \
//	  | go run examples/go/main.go
//
// The interactive version at /api/examples.html runs this same file against a
// snapshot of five shows, so the sandbox never needs network access.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
)

type Pricing struct {
	From *float64 `json:"from"`
}

type Run struct {
	Opens  string `json:"opens"`
	Closes string `json:"closes"`
}

type Venue struct {
	Name string `json:"name"`
}

type Show struct {
	Title   string   `json:"title"`
	ArtForm string   `json:"artForm"`
	Run     Run      `json:"run"`
	Venue   Venue    `json:"venue"`
	Pricing *Pricing `json:"pricing"`
	URL     string   `json:"url"`
}

type Feed struct {
	Total int    `json:"total"`
	Shows []Show `json:"shows"`
}

func main() {
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Could not read stdin:", err)
		os.Exit(1)
	}
	if len(raw) == 0 {
		fmt.Fprintln(os.Stderr,
			"No input. Pipe an API response in, for example:\n"+
				"  curl -s 'https://glasgowtheatre.com/api/v1/shows-preview.json'"+
				" | go run main.go")
		os.Exit(1)
	}

	var feed Feed
	if err := json.Unmarshal(raw, &feed); err != nil {
		fmt.Fprintln(os.Stderr, "That was not JSON:", err)
		os.Exit(1)
	}

	limit := len(feed.Shows)
	if limit > 5 {
		limit = 5
	}
	fmt.Printf("%d upcoming shows (showing %d)\n\n", feed.Total, limit)
	for _, show := range feed.Shows[:limit] {
		price := "price at venue"
		if show.Pricing != nil && show.Pricing.From != nil {
			price = fmt.Sprintf("from £%.2f", *show.Pricing.From)
		}
		fmt.Printf("%s  %s\n", show.Run.Opens, show.Title)
		fmt.Printf("          %s · %s · %s\n", show.Venue.Name, show.ArtForm, price)
		fmt.Printf("          %s\n\n", show.URL)
	}
}

# Bluesky Thread Collator

A lightweight, zero-dependency Node.js utility that extracts complete, multi-post author threads from [Bluesky](https://bsky.app) and compiles them into clean, readable text and HTML documents.

---

## Features

- **Complete Thread Retrieval:** Traverses deep thread trees and author feeds to reliably capture long self-threads (100+ posts) without truncating.
- **Zero Dependencies:** Built entirely with native Node.js APIs (`fetch`, `fs`). No external npm packages required.
- **No Developer Account Needed:** Leverages public AT Protocol AppView endpoints—no API keys, authentication tokens, or app passwords necessary.
- **Dual Format Output:**
  - **Plain Text (`.txt`):** Structured output with timestamped paragraphs (`[HH:MM:SS]`), perfect for reading or archival.
  - **HTML (`.html`):** A modern, responsive light-theme reader interface designed for easy readability.
- **Author Context:** Automatically includes the author's display name, handle, bio, total post count, and direct source link in the output header.

---

## Requirements

- **Node.js** v18.0.0 or higher (for native `fetch` support).

---

## Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/bluesky-thread-collator.git
   cd bluesky-thread-collator
   ```

2. **Run the script with any public Bluesky post URL:**
   ```bash
   node bsky_thread.js "https://bsky.app/profile/bob.bsky.social/post/3mxonfgoenc2k"
   ```

---

## Output Files

The script generates two files named after the post's record key (`<rkey>`):

1. **`bluesky_thread_<rkey>.txt`**
   ```text
   ===================================================================
   AUTHOR: Bob McBobFace (@bob.bsky.social)
   BIO:    Just doing bob things...
   SOURCE: https://bsky.app/profile/bob.bsky.social/post/3mxonfgoenc2k
   POSTS:  188
   ===================================================================

   [14:15:02] First post of the long thread introducing the main topic...

   [14:16:21] The second post continuing the discussion right below it...
   ```

2. **`bluesky_thread_<rkey>.html`**
   Open this file in any modern web browser for a styled, distraction-free reading experience.

---

## How It Works

1. **Handle Resolution:** Translates the handle from the provided URL into an AT Protocol Decentralized Identifier (DID) via `com.atproto.identity.resolveHandle`.
2. **Profile & Thread Fetching:** Grabs profile info and initial thread tree context via `app.bsky.actor.getProfile` and `app.bsky.feed.getPostThread`.
3. **Feed Traversal:** Deep-scans the author's feed via `app.bsky.feed.getAuthorFeed` using pagination to locate and verify every contiguous reply in the chain.
4. **Collation & Sorting:** Sorts all verified thread posts chronologically and formats the output into clean `.txt` and `.html` files.

---

## License

[MIT](LICENSE)
import fs from 'fs';

async function main()
{
    // Retrieve the Bluesky post URL from command line arguments
    const urlArg = process.argv[2];
    if (!urlArg)
    {
        console.error("Error: Please provide a Bluesky post URL.");
        console.error("Usage: node bsky_thread.js <bluesky_post_url>");
        process.exit(1);
    }

    // Parse handle and starting post rkey from the web URL structure
    const urlPattern = /\/profile\/([^\/]+)\/post\/([^\/]+)/;
    const match = urlArg.match(urlPattern);
    if (!match)
    {
        console.error("Error: Invalid Bluesky post URL format.");
        process.exit(1);
    }

    const handle = match[1];
    const targetRkey = match[2];
    const sourceUrl = urlArg.trim();

    console.log(`[1/5] Resolving profile and handle '${handle}' to DID...`);
    
    // Fetch profile data (display name, bio, DID)
    const profileRes = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${handle}`);
    if (!profileRes.ok)
    {
        console.error(`Failed to resolve actor profile: ${profileRes.statusText}`);
        process.exit(1);
    }

    const profileData = await profileRes.json();
    const targetDid = profileData.did;
    const displayName = profileData.displayName || handle;
    const handleName = `@${profileData.handle}`;
    const bioText = profileData.description ? profileData.description.trim() : 'No bio available.';

    console.log(`      Resolved: ${displayName} (${handleName}) -> DID: ${targetDid}`);

    const startingUri = `at://${targetDid}/app.bsky.feed.post/${targetRkey}`;
    console.log(`[2/5] Fetching initial post thread graph from public AppView endpoints...`);

    // Call getPostThread with maximum depth parameters
    const threadUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(startingUri)}&depth=1000&parentHeight=1000`;
    const threadRes = await fetch(threadUrl);
    if (!threadRes.ok)
    {
        console.error(`Failed to fetch thread: ${threadRes.statusText}`);
        process.exit(1);
    }

    const threadData = await threadRes.json();
    const discoveredPostsMap = new Map();

    // Helper function to store unique post objects
    function addPostToMap(post)
    {
        if (post && post.author && post.author.did === targetDid)
        {
            discoveredPostsMap.set(post.uri, {
                uri: post.uri,
                text: post.record?.text || '',
                createdAt: post.record?.createdAt || '',
                replyToUri: post.record?.reply?.parent?.uri || null
            });
        }
    }

    // Traverse thread nodes recursively
    function traverseThread(node)
    {
        if (!node)
        {
            return;
        }

        if (node.$type === 'app.bsky.feed.defs#threadViewPost' && node.post)
        {
            addPostToMap(node.post);
        }

        if (node.parent)
        {
            traverseThread(node.parent);
        }

        if (Array.isArray(node.replies))
        {
            for (const reply of node.replies)
            {
                traverseThread(reply);
            }
        }
    }

    traverseThread(threadData.thread);

    // Identify starting post creation timestamp to narrow down feed pagination scope
    const startPostObj = discoveredPostsMap.get(startingUri);
    const startTimestamp = startPostObj ? new Date(startPostObj.createdAt).getTime() : Date.now();

    console.log(`[3/5] Deep-scanning author feed for additional thread chain posts...`);

    let cursor = null;
    let keepPaginating = true;
    let pageCount = 0;

    // Paginate through author's feed to discover full contiguous thread
    while (keepPaginating && pageCount < 20)
    {
        pageCount++;
        let feedUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${targetDid}&limit=100`;
        if (cursor)
        {
            feedUrl += `&cursor=${encodeURIComponent(cursor)}`;
        }

        const feedRes = await fetch(feedUrl);
        if (!feedRes.ok)
        {
            break;
        }

        const feedData = await feedRes.json();
        if (!feedData.feed || feedData.feed.length === 0)
        {
            break;
        }

        for (const item of feedData.feed)
        {
            const post = item.post;
            if (post && post.author && post.author.did === targetDid)
            {
                const postTime = new Date(post.record?.createdAt || 0).getTime();
                
                // Stop paginating if posts are more than 7 days prior to thread start
                if (startTimestamp - postTime > 7 * 24 * 60 * 60 * 1000)
                {
                    keepPaginating = false;
                }

                addPostToMap(post);
            }
        }

        cursor = feedData.cursor;
        if (!cursor)
        {
            break;
        }
    }

    // Filter posts linked to thread chain starting at root
    const allPosts = Array.from(discoveredPostsMap.values());
    const validUrisInChain = new Set([startingUri]);

    let growth = true;
    while (growth)
    {
        growth = false;
        for (const post of allPosts)
        {
            if (!validUrisInChain.has(post.uri) && post.replyToUri && validUrisInChain.has(post.replyToUri))
            {
                validUrisInChain.add(post.uri);
                growth = true;
            }
        }
    }

    // Chronologically sort all verified thread posts
    const chainPosts = allPosts
        .filter(p => validUrisInChain.has(p.uri))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    console.log(`[4/5] Collation complete. Found ${chainPosts.length} posts in the thread.`);

    if (chainPosts.length === 0)
    {
        console.log("No posts found in the thread context.");
        return;
    }

    console.log(`[5/5] Generating text and HTML output files...`);

    // Format Text File Output
    const txtHeader = [
        `===================================================================`,
        `AUTHOR: ${displayName} (${handleName})`,
        `BIO:    ${bioText.replace(/\n/g, ' ')}`,
        `SOURCE: ${sourceUrl}`,
        `POSTS:  ${chainPosts.length}`,
        `===================================================================\n`
    ].join('\n');

    const txtParagraphs = chainPosts.map(post =>
    {
        const timeStr = new Date(post.createdAt).toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        return `[${timeStr}] ${post.text}`;
    });

    const txtContent = txtHeader + txtParagraphs.join('\n\n');
    const txtFileName = `bluesky_thread_${targetRkey}.txt`;
    fs.writeFileSync(txtFileName, txtContent, 'utf8');

    // Format HTML File Output
    function escapeHtml(text)
    {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    const htmlPosts = chainPosts.map((post, idx) =>
    {
        const timeStr = new Date(post.createdAt).toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const formattedBody = escapeHtml(post.text).replace(/\n/g, '<br>');

        return `
        <article class="post-card">
            <div class="post-header">
                <span class="post-number">#${idx + 1}</span>
                <span class="post-time">${timeStr}</span>
            </div>
            <div class="post-body">${formattedBody}</div>
        </article>`;
    }).join('\n');

    const htmlDocument = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bluesky Thread - ${escapeHtml(displayName)}</title>
    <style>
        :root {
            --bg-color: #f8fafc;
            --card-bg: #ffffff;
            --text-main: #1e293b;
            --text-muted: #64748b;
            --accent-color: #0284c7;
            --border-color: #e2e8f0;
            --shadow-sm: 0 1px 3px rgba(0,0,0,0.05);
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            line-height: 1.6;
            margin: 0;
            padding: 2rem 1rem;
        }

        .container {
            max-width: 720px;
            margin: 0 auto;
        }

        .author-card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 2rem;
            box-shadow: var(--shadow-sm);
        }

        .author-name {
            font-size: 1.5rem;
            font-weight: 700;
            margin: 0;
            color: var(--text-main);
        }

        .author-handle {
            font-size: 0.95rem;
            color: var(--text-muted);
            margin-bottom: 0.75rem;
        }

        .author-bio {
            font-size: 0.95rem;
            color: var(--text-main);
            margin-bottom: 1rem;
            white-space: pre-wrap;
        }

        .meta-info {
            display: flex;
            flex-wrap: wrap;
            gap: 1rem;
            font-size: 0.875rem;
            color: var(--text-muted);
            border-top: 1px solid var(--border-color);
            padding-top: 0.75rem;
        }

        .meta-info a {
            color: var(--accent-color);
            text-decoration: none;
        }

        .meta-info a:hover {
            text-decoration: underline;
        }

        .thread-stream {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .post-card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 1.25rem;
            box-shadow: var(--shadow-sm);
        }

        .post-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 0.5rem;
            font-size: 0.8rem;
            color: var(--text-muted);
            font-weight: 600;
        }

        .post-time {
            background: var(--bg-color);
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            border: 1px solid var(--border-color);
        }

        .post-body {
            font-size: 1.05rem;
            word-wrap: break-word;
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="author-card">
            <h1 class="author-name">${escapeHtml(displayName)}</h1>
            <div class="author-handle">${escapeHtml(handleName)}</div>
            <div class="author-bio">${escapeHtml(bioText)}</div>
            <div class="meta-info">
                <span><strong>Total Posts:</strong> ${chainPosts.length}</span>
                <span><strong>Source:</strong> <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">View on Bluesky</a></span>
            </div>
        </header>

        <main class="thread-stream">
            ${htmlPosts}
        </main>
    </div>
</body>
</html>`;

    const htmlFileName = `bluesky_thread_${targetRkey}.html`;
    fs.writeFileSync(htmlFileName, htmlDocument, 'utf8');

    console.log(`      Successfully written '${txtFileName}'.`);
    console.log(`      Successfully written '${htmlFileName}'.`);
}

main().catch(error =>
{
    console.error("An unexpected error occurred:", error);
    process.exit(1);
});
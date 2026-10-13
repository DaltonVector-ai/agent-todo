/**
 * Embedded web board assets. Regenerate with `bun run scripts/embed-web.ts`.
 */
export type BoardAsset = { path: string; content: Uint8Array; contentType: string };

/** Minimal fallback board when the Vite bundle has not been embedded yet. */
const FALLBACK_INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>agent-todo board</title>
  <style>
    :root { font-family: system-ui, sans-serif; color-scheme: light dark; }
    body { margin: 0; padding: 1rem; }
    h1 { font-size: 1.25rem; margin: 0 0 1rem; }
    .board { display: flex; gap: 0.75rem; overflow-x: auto; align-items: flex-start; }
    .col { min-width: 11rem; background: #8882; border-radius: 8px; padding: 0.5rem; }
    .col h2 { font-size: 0.75rem; text-transform: uppercase; margin: 0 0 0.5rem; opacity: 0.8; }
    .card { background: #fff2; border-radius: 6px; padding: 0.5rem; margin-bottom: 0.5rem; cursor: pointer; font-size: 0.85rem; }
    .drawer { position: fixed; top: 0; right: 0; width: min(24rem, 100%); height: 100%; background: #111c; color: #eee; padding: 1rem; box-sizing: border-box; overflow: auto; display: none; }
    .drawer.open { display: block; }
    .meta { opacity: 0.7; font-size: 0.75rem; }
    button { margin-top: 0.5rem; }
  </style>
</head>
<body>
  <h1>agent-todo board</h1>
  <p class="meta" id="status">Loading…</p>
  <div class="board" id="board"></div>
  <aside class="drawer" id="drawer"></aside>
  <script>
    const STATUSES = ["todo","open","inprogress","reopen","verifying","verified","deploying","deployed"];
    let board = null;
    let es = null;
    async function loadBoard() {
      const res = await fetch("/api/board");
      board = await res.json();
      render();
      document.getElementById("status").textContent = "Live · rev " + board.rev;
    }
    function render() {
      const root = document.getElementById("board");
      root.innerHTML = "";
      for (const status of STATUSES) {
        const col = document.createElement("div");
        col.className = "col";
        const h = document.createElement("h2");
        h.textContent = status + " (" + (board.columns[status]?.length || 0) + ")";
        col.appendChild(h);
        for (const t of board.columns[status] || []) {
          const card = document.createElement("div");
          card.className = "card";
          card.textContent = t.id + " · " + t.title;
          card.onclick = () => openTask(t.groupKey, t.id);
          col.appendChild(card);
        }
        root.appendChild(col);
      }
    }
    async function openTask(groupKey, id) {
      const res = await fetch("/api/groups/" + encodeURIComponent(groupKey) + "/tasks/" + encodeURIComponent(id));
      const data = await res.json();
      const d = document.getElementById("drawer");
      d.className = "drawer open";
      d.innerHTML = "<h2>" + data.task.id + "</h2><p>" + data.task.title + "</p><pre>" + JSON.stringify(data.comments, null, 2) + "</pre><button onclick=\\"closeDrawer()\\">Close</button>";
    }
    function closeDrawer() { document.getElementById("drawer").className = "drawer"; }
    function connectSse() {
      es = new EventSource("/api/events/stream");
      es.addEventListener("change", () => loadBoard());
      es.onerror = () => { es.close(); setTimeout(connectSse, 1000); };
    }
    loadBoard().then(connectSse);
  </script>
</body>
</html>`;

export const BOARD_ASSETS: BoardAsset[] = [
	{
		path: "/index.html",
		content: new TextEncoder().encode(FALLBACK_INDEX),
		contentType: "text/html; charset=utf-8",
	},
];

export function findBoardAsset(pathname: string): BoardAsset | undefined {
	if (pathname === "/" || pathname.startsWith("/g/")) {
		return BOARD_ASSETS.find((a) => a.path === "/index.html");
	}
	const normalized = pathname === "/" ? "/index.html" : pathname;
	return BOARD_ASSETS.find((a) => a.path === normalized);
}

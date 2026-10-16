# Open SQLite server

## Problem Statement

Installing agent-todo creates accounts, passwords, and bearer tokens, and the product also has a Postgres server. People need one open server, stored in SQLite, and an install conversation that either starts that server or connects this machine to one that is already running.

## Solution

`agent-todo install` asks whether to start a server on this machine or connect to an existing one. Starting a server runs the machine daemon on SQLite, listens on the local network unless the person chooses this machine only, and points every detected MCP client at that daemon with no credentials. Connecting asks for the server's base URL, checks that it is agent-todo, and points MCP clients at it without starting a daemon. Anyone who can reach the server can read and write. `init` creates a project on that server, or joins the project whose code is already in `AGENTS.md`. There is no Postgres server, no cloud sync, and no authentication.

## User Stories

1. As a person installing agent-todo, I want install to ask whether I am starting a server or connecting to an existing one, so that this machine is set up for the role I actually want.
2. As a person installing agent-todo, I want that question in an interactive terminal prompt, so that I can answer it without memorizing flags.
3. As a person installing agent-todo, I want to cancel the prompt and leave the machine unchanged, so that a mistaken install does not rewrite agent configuration.
4. As a person installing agent-todo, I want a summary of what will change and a confirmation before anything is written, so that I can see the listen address or the remote URL first.
5. As a person starting a server, I want the local network selected by default, so that other devices on the LAN can reach the daemon.
6. As a person starting a server, I want to choose "this machine only" instead, so that the daemon listens only on this computer.
7. As a person starting a server, I want the local-network choice to say that anyone who can reach the port can read and write the board, so that I understand what I am opening.
8. As a person starting a server, I want the daemon started and kept running after login, so that agents can use it without a separate start step.
9. As a person starting a server, I want detected MCP clients pointed at this daemon, so that I do not hand-edit each agent.
10. As a person starting a server, I want those MCP entries to contain the daemon URL and no authorization header, so that clients connect without a token.
11. As a person starting a server on the local network, I want the LAN URLs printed, so that another machine knows what to paste.
12. As a person starting a server, I want clients on this same machine to use the loopback URL, so that they connect even though the daemon listens on all interfaces.
13. As a person connecting to an existing server, I want to type a base URL, so that I do not have to know the MCP path.
14. As a person connecting to an existing server, I want install to accept `http` and `https` URLs, so that a LAN address and a reverse-proxied address both work.
15. As a person connecting to an existing server, I want a trailing slash ignored, so that a pasted origin still works.
16. As a person connecting to an existing server, I want a pasted MCP URL accepted as that same server, so that pasting the client endpoint still connects.
17. As a person connecting to an existing server, I want install to refuse a URL that is not this agent-todo server, so that agent configuration is not pointed at the wrong program.
18. As a person connecting to an existing server, I want a refused URL to leave every config file unchanged, so that a typo does not half-configure the machine.
19. As a person connecting to an existing server, I want no local daemon and no login autostart, so that this machine is only a client.
20. As a person connecting to an existing server, I want MCP clients pointed at that server's MCP URL with no authorization header, so that they use the shared board.
21. As a person on a second machine, I want to paste a LAN URL from the host, so that I join the server the host just started.
22. As a person who put a reverse proxy in front of the daemon, I want other machines to connect with the proxy URL, so that exposure beyond the LAN stays my setup.
23. As a person running install again, I want the new answers to replace the previous setup, so that I can switch this machine from host to client or the other way.
24. As a person switching from a local server to an external one, I want the summary to say the local server will stop, so that I do not disconnect other machines by surprise.
25. As a person switching from a local server to an external one, I want the local daemon stopped and login autostart removed, so that this machine stops hosting.
26. As a person switching from a local server to an external one, I want the SQLite file left on disk, so that the board data is still there if I host again.
27. As a person switching to an external server, I want the health check to succeed before the local daemon is stopped, so that a bad URL does not take the server down.
28. As a person starting a server again, I want the daemon restarted on the listen address I just chose, so that a change from loopback to the local network takes effect.
29. As a person running install from a script, I want `--local` to start the server on the local network with no prompts, so that automation gets the recommended setup.
30. As a person running install from a script, I want `--local --loopback` to listen on this machine only, so that a script can keep the server private.
31. As a person running install from a script, I want `--url` to connect to that base URL with the same health check and no prompts, so that automation can join a server.
32. As a person running install with no terminal and no flags, I want a non-zero exit and no config changes, so that a stray command does not open the server on the network.
33. As a person passing both `--local` and `--url`, I want install to reject that and write nothing, so that one command cannot be both host and client.
34. As a person passing `--loopback` without `--local`, I want install to reject that, so that the listen choice is attached to starting a server.
35. As an agent, I want MCP calls to succeed with no token, so that I can read and update tasks on a server I can reach.
36. As an agent, I want every tool the daemon implements, so that a missing account does not hide plan or admin tools.
37. As an agent using stdio, I want `serve` to forward to the server chosen at install, with no bearer token, so that stdio clients follow the same setup.
38. As an agent, I want a clear error when that server is not running, so that I know to run install or start the host.
39. As a person in a repository, I want `init` to talk to the server chosen at install, so that the project is created where the agents already point.
40. As a person initializing a repository for the first time, I want `init` to create the project and write the project code and default group into `AGENTS.md`, so that other machines can join it.
41. As a person initializing a repository that already has a project code, I want `init` to join that project on the server, so that two machines share one board.
42. As a person initializing a repository, I want no token and no bootstrap secret, so that joining a project is not an account setup.
43. As a person initializing a repository while the chosen server is down, I want `init` to fail without writing a new project identity, so that the repo is not given a code the server does not have.
44. As a person claiming work, I want comments and claims to keep recording the actor name I set, so that the board still shows who did the work without user accounts.
45. As a person opening the web board, I want it to load with no sign-in, so that a reachable server is usable in a browser.
46. As a person who previously had an admin password, I want install to succeed without creating or asking for one, so that old account setup is gone.
47. As a person running uninstall, I want agent MCP entries restored and login autostart removed, so that agents no longer point at agent-todo.
48. As a person running uninstall on a host, I want the local daemon stopped and the SQLite file kept, so that wiring is removed and the board data remains.
49. As a person running uninstall on a client, I want uninstall to leave the remote server alone, so that removing this machine does not stop everyone else.
50. As a person importing or exporting, I want those commands to keep reading and writing the SQLite database, so that backup and markdown exchange still work.
51. As a person checking the setup, I want doctor to report the saved server URL and whether its health check is agent-todo, so that I can see a bad connection without looking for a token.
52. As a person reading help, I want the accounts, server, push, and pull commands gone, so that the commands match a product with one SQLite daemon.

## Implementation Decisions

- The only server is the machine daemon. It stores all projects, groups, tasks, comments, and context in one SQLite database. The default port stays 8787. Install does not ask for a port.
- Install's interactive flow uses the same prompt style as the `skills` package: an intro, selects whose options have a label and a hint, a text field for the URL, a summary note, and a confirmation. Cancel exits non-zero and writes nothing. The prompts only collect the same choices the flags accept.
- The first select is "Start a new server" or "Connect to an external server".
- "Start a new server" then selects the listen address. "Local network (Recommended)" is the initial selection and listens on `0.0.0.0`. "This machine only" listens on `127.0.0.1`. The local-network hint states that anyone who can reach the port can read and write the board.
- "Connect to an external server" asks for the base URL and does not ask for a listen address.
- A base URL must be `http` or `https` and must have a host. A trailing slash is removed. A path of `/` or empty is the base. A path of `/mcp` is accepted and stripped back to the base. Any other path, query, or fragment is rejected.
- Before an external install changes anything, including stopping a local daemon, it requests `/health`. The install continues only when the response is OK, `status` is `ok`, and `service` is `agent-todo`. Otherwise it exits non-zero and writes nothing.
- MCP clients are configured with the HTTP endpoint `<base>/mcp` and no authorization header. On a local install, `<base>` is `http://127.0.0.1:8787` even when the daemon listens on `0.0.0.0`. The printed LAN URLs are the ones another machine pastes.
- The machine client record stores that base URL only. Usernames, passwords, and tokens are not stored.
- The listen address is persisted for the daemon. A local install starts the daemon if it is down, and restarts it when it is already up so the listen address is applied. It registers login autostart and wires the same detected agents as today.
- An external install does not start a daemon. If this machine was hosting, it stops the daemon after the health check succeeds, removes login autostart, and leaves the SQLite file in place.
- Flags skip the prompts and the confirmation. `--local` listens on `0.0.0.0`. `--local --loopback` listens on `127.0.0.1`. `--url <base>` is an external install. `--local` together with `--url` is an error. `--loopback` without `--local` is an error. No terminal and no mode flag is an error. Errors write nothing.
- `init` uses the saved base URL and sends no credentials. With no project code in the repo, it creates a project and writes the project code and default group into `AGENTS.md` and the project config. With a project code, it joins that project on the server. The repo config does not store a mode, a remote URL, or a token. A failed request does not write a new identity.
- Actor names on comments and claims stay free text, including the name supplied by the environment. They are not accounts.
- The daemon accepts HTTP and MCP calls with no credential. Sign-in, sessions, users, passwords, bearer tokens, OAuth, API tokens, bootstrap secrets, roles, and per-token tool ceilings and group allow-lists are removed. Every tool the daemon implements is available to every caller.
- The web board has no sign-in screen and loads the board directly.
- `accounts`, `server`, `push`, and `pull` are removed. The Postgres store and the deploy setup that exists to run that server are removed. `import` and `export` stay on SQLite.
- `serve` forwards stdio to the saved base URL with no bearer token. If the health check fails, it tells the person to run install.
- Doctor reports the saved URL and whether `/health` is this daemon. It does not look for a user or a token.
- Uninstall restores agent MCP configuration, removes login autostart, and stops the local daemon when this machine has one. It keeps the SQLite file and does not contact an external server.
- An existing SQLite file keeps its tasks, groups, and context. User and session data is unused and is not required at install.

## Testing Decisions

- Test external behavior at the existing CLI seam: run install and init against a real daemon and assert the resulting process, files, and HTTP calls. Do not test the prompt widgets; the flags are the contract those prompts collect.
- One flow covers a local install that listens on `0.0.0.0`, writes MCP entries with the loopback MCP URL and no authorization header, and registers autostart. An MCP call and `init` succeed with no token, and `init` writes the project code and default group. A second client installs with `--url` only after `/health` identifies agent-todo, writes MCP entries for that URL, and does not start a daemon. `init` with the same project code joins that project. Installing with `--url` on the host stops the daemon, removes autostart, and leaves the SQLite file. Uninstall restores MCP configuration, removes autostart, stops a local daemon, leaves the database, and does not call an external server.
- Also cover the failure edges at that seam: a non-agent-todo health response writes nothing, no terminal and no flags writes nothing, and `--local` with `--url` writes nothing.
- Remove tests that exist only for accounts, bearer tokens, dashboard sign-in, OAuth, API tokens, bootstrap, Postgres, and cloud push or pull.
- Prior art is the current daemon install, autostart, network, remote-install, and init tests. Extend those instead of adding a new harness.

## Out of Scope

- Reverse proxies, TLS termination, firewalls, and DNS. Binding to the local network is in scope. Publishing that port beyond the LAN is the operator's work.
- A Postgres server, a second database, and cloud push or pull. This spec does not leave a compatibility layer for them.
- Users, passwords, sessions, tokens, OAuth, roles, and per-caller tool restrictions.
- Choosing a port during install.
- Deleting the SQLite file on uninstall or when switching to an external server.
- Solving two machines that run `init` before either has committed `AGENTS.md`.

## Further Notes

- A server on `0.0.0.0` with no authentication means every device that can open the port can read and change the board, including deletes.
- The interactive default is the local network because a person sees that hint. A script must pass `--local` to get the same listen address. There is no silent default for a non-interactive run.

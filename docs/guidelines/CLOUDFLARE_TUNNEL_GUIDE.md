# Cloudflare Tunnel Guide

## Quick Start

Open any terminal (PowerShell, CMD, or Git Bash) and run:

```powershell
cloudflared tunnel --url http://localhost:PORT
```

Replace `PORT` with your local port number.

## Examples

```powershell
# Tradebot dashboard (port 3000)
cloudflared tunnel --url http://localhost:3000

# Another project (port 3001)
cloudflared tunnel --url http://localhost:3001

# React dev server (port 5173)
cloudflared tunnel --url http://localhost:5173
```

## Output

After running, you'll see a URL like:
```
https://random-words-here.trycloudflare.com
```

Share this URL with anyone - they can access your local site.

## Notes

- Each tunnel needs its own terminal window
- Close terminal = tunnel stops
- URL changes each time you restart the tunnel
- No account or login needed
- Unlimited free tunnels

## Full Path (if command not found)

```powershell
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:PORT
```

---

[Back to STRUCTURE](../STRUCTURE.md)

# Clustar Mobile — Run Guide (Expo)

Get the app running on your phone via Expo Go, pointing at the API on your laptop.

## Prereqs

- Node.js 20+ and npm (same as backend)
- **Expo Go** on your phone — [iOS App Store](https://apps.apple.com/app/expo-go/id982107779) or [Google Play](https://play.google.com/store/apps/details?id=host.exp.exponent)
- Phone and laptop on the **same Wi-Fi network**
- The Clustar API running (`clustar-api` — see its own `RUN.md`)

## One-time setup

### 1. Find your laptop's LAN IP

Open cmd and run:

```
ipconfig
```

Look under your active adapter (usually "Wireless LAN adapter Wi-Fi") for the line `IPv4 Address`. It'll look like `192.168.1.100` or `10.0.0.42`. **This is not your public IP** — it's a local network address starting with `192.168.` or `10.` or `172.16.–172.31.`.

### 2. Set it in `app.json`

Open `clustar-mobile/app.json`, find `extra.apiBaseUrl`, and replace the IP with yours:

```json
"extra": {
  "apiBaseUrl": "http://192.168.1.100:3000"
}
```

Keep the `http://`, keep the `:3000`, only swap the IP.

### 3. Install deps

```
cd C:\Users\EmmanuelHillary\Desktop\WORKSPACE\My Projects\clustar\clustar-mobile
npm install
```

This takes a few minutes the first time.

### 4. Make sure the API is listening on your LAN, not just localhost

Node's default is to bind to `0.0.0.0` (all interfaces), which is what you want. To verify: from your phone's browser, visit `http://<your-laptop-IP>:3000/health` — should return `{"ok":true,"service":"clustar-api",...}`.

**If it doesn't**, Windows Firewall is probably blocking port 3000. When Windows first pops up "Do you want to allow Node.js through the firewall?", say yes to both private and public networks. Or add a manual rule:

```
netsh advfirewall firewall add rule name="Clustar API" dir=in action=allow protocol=TCP localport=3000
```

## Start the app

```
npm start
```

A QR code appears in the terminal. On iOS, open the Camera and point it at the QR. On Android, open Expo Go and use its scanner. The app downloads to your phone in 10–20 seconds.

## First run

1. **Splash → Phone screen.** Type your number (any format works; the OTP is stubbed).
2. **Tap "Send code".** Check the API terminal — you'll see `[DEV OTP] +2348123456789: 483927`.
3. **Type the 6 digits.** Auto-submits when full.
4. **Location permission prompt.** Allow it.
5. **Feed loads.** Empty on first run — no clustars near you yet.
6. **Tap the orange +** to create one at your current location.
7. **Tap the card** to open the thread, reply from the composer at the bottom.

## Common issues

**"Could not reach API at http://..."** — three possible causes:
- API isn't running (check the `clustar-api` terminal)
- Wrong IP in `app.json` (`ipconfig` again — Wi-Fi IP changes if you switch networks)
- Firewall blocking (see step 4 above)

**"Location unavailable"** — the phone denied the permission. On iOS: Settings → Expo Go → Location → While Using. On Android: Settings → Apps → Expo Go → Permissions → Location.

**QR scan does nothing** — phone and laptop are on different networks. Common if your laptop is on 5GHz and phone on 2.4GHz — same SSID but different subnet.

**"tunnel" instead of LAN** — if LAN doesn't work at all (some corporate networks block peer-to-peer), run `npm start --tunnel`. Slower but goes through Expo's relay.

**Metro bundler errors on save** — press `r` in the Metro terminal to reload the app, or shake the phone and tap "Reload" in the dev menu.

## What works in Alpha

- Phone OTP sign-in (OTP prints to API terminal)
- See your real location on the feed
- Create clustars at your current spot with a radius preset
- Discover clustars near you (heat-ranked)
- Open a thread, reply, see live-ish replies (polls every 8s until WebSocket lands)

## What's not yet wired (coming next)

- Realtime replies via WebSocket (currently 8s polling)
- Image uploads (button not shown; MinIO ready backend-side)
- Burner identities toggle
- Push notifications

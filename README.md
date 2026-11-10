# Cinema Room

Watch a YouTube video inside a 3D cinema hall. Pick your seat, look around, and watch together with friends in sync.

## What it does

- A 3D hall with a giant screen. The real YouTube player sits on the screen.
- Choose a seat on the seat map or by clicking a seat. The camera flies there.
- Lights go down when the film plays. The screen lights the room.
- Watch together: start a room, send the link. Everyone plays the same video from YouTube at the same moment. The host controls play, pause and the video. Friends show up in their seats.
- Show a tab or window: put any browser tab on the screen, with 3D sound and room light that follows the real picture (Chrome or Edge, on a computer).

## Run it on your computer

Needs Node.js.

```
node server.mjs
```

Then open `http://cinema.localhost:41731/`. On Windows you can double-click `start.cmd`.

## How the sync works

Only small control messages travel between the browsers (play, pause, time, seat). They use a WebRTC data channel that is set up through the public PeerJS service. The video itself comes from YouTube for each viewer.

## Credits

- Materials: Poly Haven (CC0), polyhaven.com
- three.js (MIT)
- PeerJS (MIT)
- Video playback: YouTube IFrame Player

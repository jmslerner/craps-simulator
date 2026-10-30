# Manual checks

Checks that only a person on real hardware can make. Each row stays **PENDING** until someone
runs the check and writes down what they measured; nobody records a device result they did not
measure themselves. Automated checks live in `npm run verify` and `npm run e2e`.

| Id | Milestone | Check | Status | Measured by / on | Result |
|---|---|---|---|---|---|
| MC-1 | M10b | iPhone: the 3D dome holds ≥45 fps during a throw and no face swap is ever visible | **PENDING** | — | — |

## MC-1 — iPhone frame rate and face swap (M10b)

The plan (§10 M10b) asks for a manual iPhone check: at least 45 fps while the dice tumble, and no
visible change of pips on a die in flight or at rest. The dome's own monitor drops a quality tier
when the median frame runs over 22 ms (under 45 fps), so a device that cannot hold the rate on
its starting tier settles one tier lower on the second or third throw and keeps that tier for the
next visit (`localStorage` key `bct:v1:dome-quality`).

### Steps

1. Open the deployed build on the iPhone in Safari (and, if available, Chrome). Note the model
   and iOS version.
2. Turn **3D dice** on (the toggle in the dome's bottom-right corner). Leave the quality pin on
   **Auto**; note the tier it names (expected: `Medium` on a coarse pointer).
3. Bet $5 on the pass line and roll at least 20 times, watching the dice: in flight, on landing
   and at rest.
4. Measure the frame rate during throws. Either:
   - connect the phone to a Mac, open Safari's Web Inspector → Timelines → record a throw, and
     read the frames-per-second track; or
   - open the quality pin and watch whether Auto's tier changes after the second or third throw
     (a drop means the monitor saw a median frame over 22 ms on the starting tier).
5. Repeat step 3 with the quality pin on **Low** and on **High**.
6. Lock and unlock the phone mid-throw, and switch apps and back: the roll must reveal the
   stored result (never re-roll) and the dome must keep working or offer **Retry 3D**.

### Record

- Device model, iOS and browser versions.
- Frame rate per tier (Auto's chosen tier, Low, High): the median and the lowest seen during a
  throw; whether Auto dropped a tier and on which throw.
- Face swaps: how many rolls watched, and whether any die was seen changing its pips other than
  by tumbling. Note the roll index of any suspect roll so it can be replayed from the session
  seed (`?seed=` in an e2e build reproduces the same dice and the same physics).
- Any visual fault: a die intersecting the floor, dome or other die; flicker; a blank canvas.

### Pass

≥45 fps median on Auto's tier during throws, no face swap seen in ≥20 rolls, and the lock/switch
interruptions reveal the stored roll. Update the table row with the status (**PASS** / **FAIL**),
who measured, the device, and the numbers.

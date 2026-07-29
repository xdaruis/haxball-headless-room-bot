Fix:
Important: Shooting near the ball without touching it can still register a fake touch and reset the antiafk timer. Improve this — simple version: after goals or at match start, just watch whether the match timer moved; if it didn't, the kicking team never properly touched the ball for kickoff.

1. Mid-pick leave shrinks `getEffectiveSize()` → `chooseComplete()` fires early → captain/extras stuck in spec (lock pick target at choose start; always `choosePlayer()` on leave).


Features:
1. Commands translation by geo (low priority)

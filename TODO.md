Fix:
1. 2x2 map not getting auto selected
2. rosterQueue: per-player cancel rules (add/remove coalesce) if needed

Features:
1. Roster event queue: serial tasks from bulk joins/leaves/kicks, coalesce/cancel pairs (e.g. pending `addPlayer` dropped by `removePlayer` before run) — replace scattered `setTimeout`/`scheduleBalanceTeams` triggers.
2. Make separate repo with db backup script :)
3. Could prob make commands translation depending on users geo location but who cares
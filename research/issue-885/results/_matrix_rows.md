| ID | seam | loops | started/settled hb/dl | lastSettledAt | hbC/dlC max | readiness | biz | loop | ERROR | operability.* | det/rec (as-built) | C det/rec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E0-normal-empty-tick | none (clean) | both | 7/7 , 7/7 | advances (settled) | 0/0 | 0+0 | 0 | 0 | 0 | 0 | — / — | — / — |
| E1-db-down-throws | pingDb + org discovery: ECONNREFUSED | both | 11/11 , 11/11 | advances (settled) | 0/0 | 1+1 | 0 | 0 | 15 | 2 | 0ms / 0ms | 105000ms / 15000ms |
| E2-both-org-discovery-logic-throw | org discovery: logic Error | both | 12/12 , 12/12 | advances (settled) | 0/0 | 0+0 | 0 | 0 | 18 | 0 | — / — | 105000ms / 15000ms |
| E2-hb-attempt-discovery-logic-throw | hb listInProgress: logic Error | heartbeat | 12/12 , 12/12 | advances (settled) | 0/0 | 0+0 | 0 | 0 | 9 | 0 | — / — | 105000ms / 15000ms |
| E2-dl-attempt-discovery-logic-throw | dl listDeadlineCandidates: logic Error | deadline_scanner | 12/12 , 12/12 | advances (settled) | 0/0 | 0+0 | 0 | 0 | 9 | 0 | — / — | 105000ms / 15000ms |
| E3-hb-pg-query-error | hb listInProgress: PostgreSQL 42703 | heartbeat | 12/12 , 12/12 | advances (settled) | 0/0 | 0+0 | 0 | 0 | 9 | 0 | — / — | 105000ms / 15000ms |
| E3-dl-pg-query-error | dl listDeadlineCandidates: PostgreSQL 42703 | deadline_scanner | 12/12 , 12/12 | advances (settled) | 0/0 | 0+0 | 0 | 0 | 9 | 0 | — / — | 105000ms / 15000ms |
| E4-both-business-failures-settle | db.transaction rejects (per-item) | both | 11/11 , 11/11 | advances (settled) | 7/7 | 0+0 | 4 | 0 | 23 | 4 | 105000ms / 15000ms | — / — |
| E5-hb-alternating-biz-and-throw | alternating tx + hb discovery | heartbeat | 18/18 , 18/18 | advances (settled) | 8/0 | 0+0 | 2 | 0 | 23 | 2 | 195000ms / 15000ms | — / — |
| E5-dl-alternating-biz-and-throw | alternating tx + dl discovery | deadline_scanner | 18/18 , 18/18 | advances (settled) | 0/8 | 0+0 | 2 | 0 | 15 | 2 | 195000ms / 15000ms | — / — |
| E5-both-alternating | alternating tx + org discovery | both | 18/18 , 18/18 | advances (settled) | 8/8 | 0+0 | 4 | 0 | 38 | 4 | 195000ms / 15000ms | — / — |
| E6-hb-recover-after-continuous-throws | hb listInProgress: logic Error | heartbeat | 14/14 , 14/14 | advances (settled) | 0/0 | 0+0 | 0 | 0 | 9 | 0 | — / — | 105000ms / 15000ms |
| E6-dl-recover-after-continuous-throws | dl listDeadlineCandidates: logic Error | deadline_scanner | 14/14 , 14/14 | advances (settled) | 0/0 | 0+0 | 0 | 0 | 9 | 0 | — / — | 105000ms / 15000ms |
| E6-business-failure-recovery | db.transaction rejects (per-item) | both | 11/11 , 11/11 | advances (settled) | 6/6 | 0+0 | 4 | 0 | 20 | 4 | 105000ms / 15000ms | — / — |
| E7-restart-during-continuous-throws | org discovery: logic Error + RESTART | both | 17/17 , 17/17 | advances (settled) | 0/0 | 0+0 | 0 | 0 | 26 | 0 | — / — | 105000ms / 15000ms |
| E8-desync-short-bursts | org discovery: logic Error (3-tick + 8-tick bursts) | both | 17/17 , 17/17 | advances (settled) | 0/0 | 0+0 | 0 | 0 | 22 | 0 | — / — | 255000ms / 315000ms |
| E9-db-down-then-db-up-with-throws | ECONNREFUSED then org discovery logic Error | both | 15/15 , 15/15 | advances (settled) | 0/0 | 1+1 | 0 | 0 | 23 | 2 | 0ms / — | 105000ms / 15000ms |
| E10-business-failure-then-continuous-throws | tx rejects then org discovery logic Error | both | 18/18 , 18/18 | advances (settled) | 6/6 | 0+0 | 4 | 0 | 34 | 4 | 105000ms / 15000ms | 285000ms / 15000ms |
| E11-hung-tick-not-throwing | org discovery: never-resolving Promise (hang) | both | 2/1 , 2/1 | frozen (stalled) | 0/0 | 0+0 | 0 | 2 | 2 | 2 | 135000ms / — | — / — |

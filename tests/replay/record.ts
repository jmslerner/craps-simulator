import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'
import { ENGINE_VERSION } from '../../src/engine/version.ts'
import { serializeSession } from '../../src/engine/session/serialize.ts'
import { FIXTURE_ROLLS, recordCrapless200 } from './recorder.ts'

/**
 * Records tests/replay/fixtures/crapless-200.json: `node tests/replay/record.ts`. Run it only when
 * a change was meant to alter outcomes, payouts, hashes or events, and bump ENGINE_VERSION in the
 * same change; then copy the printed final hash into tests/replay/replay.test.ts (CLAUDE.md, the
 * ENGINE_VERSION policy).
 */

const path = fileURLToPath(new URL('./fixtures/crapless-200.json', import.meta.url))
const session = recordCrapless200()
const options = (await resolveConfig(path)) ?? {}
writeFileSync(path, await format(serializeSession(session), { ...options, filepath: path }))
const { ledger } = session.state
console.log(
  `Recorded ${FIXTURE_ROLLS} rolls on engine version ${ENGINE_VERSION} to ${path}\n` +
    `final hash ${session.committed.at(-1)?.hashAfter ?? 'none'}; ` +
    `bankroll ${ledger.bankroll}, deposits ${ledger.deposits}, house net ${ledger.houseNet}`,
)

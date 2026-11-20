// 샘플 데이터(가상)를 넣고 지우는 모듈. 내용은 sample-data.json (web/scripts/make-sample.ts 로 생성).
//  - 샘플 고객사·진단은 첫 관리자가 생기면 한 번 자동으로 들어간다(is_sample 표시, 관리자 화면에서 지울 수 있음).
//  - 샘플 계정(컨설턴트·고객)은 관리자가 버튼을 눌렀을 때만 만들고, 비밀번호는 무작위로 만들어 그때 한 번만 보여 준다.
//    (공개된 사이트에 알려진 비밀번호의 계정을 두지 않기 위해서다.)
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const DATA = JSON.parse(readFileSync(new URL('./sample-data.json', import.meta.url), 'utf8'))
const DAY = 86_400_000

const fail = (status, message) => Object.assign(new Error(message), { httpStatus: status })

export async function sampleStatus(pool) {
  const meta = await pool.query(`select value from app_meta where key = 'sample_seeded'`)
  const c = await pool.query('select count(*)::int as n from app_clients where is_sample')
  const d = await pool.query('select count(*)::int as n from app_diagnoses d join app_clients c on c.id = d.client_id where c.is_sample')
  const u = await pool.query('select username, name, role, active from app_users where is_sample order by created_at')
  return { seededBefore: meta.rows.length > 0, clientCount: c.rows[0].n, diagnosisCount: d.rows[0].n, accounts: u.rows }
}

/** 샘플 고객사·진단을 넣는다. 이미 샘플 고객사가 있으면 아무것도 하지 않는다. */
export async function seedSample(pool, ownerId) {
  const exists = await pool.query('select count(*)::int as n from app_clients where is_sample')
  if (exists.rows[0].n > 0) return { seeded: false, clients: 0, diagnoses: 0 }
  const c = await pool.connect()
  let clients = 0
  let diagnoses = 0
  try {
    await c.query('begin')
    for (const cl of DATA.clients) {
      const id = randomUUID()
      await c.query('insert into app_clients (id, owner, name, profile, created_at, is_sample) values ($1, $2, $3, $4::jsonb, $5, true)', [id, ownerId, cl.name, JSON.stringify(cl.profile), new Date(Date.now() - 14 * DAY)])
      clients++
      for (const d of cl.diagnoses) {
        const at = new Date(Date.now() - d.daysAgo * DAY)
        await c.query(
          `insert into app_diagnoses (id, owner, client_id, domain, answers, notes, status, mode, created_at, updated_at)
           values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $9)`,
          [randomUUID(), ownerId, id, d.domain, JSON.stringify(d.answers), JSON.stringify(d.notes), d.status, d.mode, at],
        )
        diagnoses++
      }
    }
    await c.query(`insert into app_meta (key, value) values ('sample_seeded', '1') on conflict (key) do update set value = '1'`)
    await c.query('commit')
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    c.release()
  }
  return { seeded: true, clients, diagnoses }
}

/** 관리자가 있고 아직 한 번도 샘플을 넣은 적이 없으면 넣는다(지운 뒤에는 다시 넣지 않는다). */
export async function ensureSampleSeeded(pool) {
  const meta = await pool.query(`select 1 from app_meta where key = 'sample_seeded'`)
  if (meta.rows.length) return
  const admin = await pool.query(`select id from app_users where role = 'admin' and active order by created_at asc limit 1`)
  if (!admin.rows[0]) return
  await seedSample(pool, admin.rows[0].id)
}

/** 샘플 고객사(진단 포함)와 샘플 계정을 지운다. 샘플 계정이 실제 고객사를 갖고 있으면 지우지 않고 비활성화한다. */
export async function removeSample(pool) {
  const c = await pool.connect()
  try {
    await c.query('begin')
    const cl = await c.query('delete from app_clients where is_sample')
    const users = await c.query('select id from app_users where is_sample')
    let deleted = 0
    let deactivated = 0
    for (const u of users.rows) {
      const own = await c.query('select count(*)::int as n from app_clients where owner = $1', [u.id])
      if (own.rows[0].n > 0) {
        await c.query('update app_users set active = false where id = $1', [u.id])
        await c.query('delete from app_sessions where user_id = $1', [u.id])
        deactivated++
      } else {
        await c.query('delete from app_users where id = $1', [u.id])
        deleted++
      }
    }
    await c.query(`insert into app_meta (key, value) values ('sample_seeded', '1') on conflict (key) do update set value = '1'`)
    await c.query('commit')
    return { clientsRemoved: cl.rowCount, accountsRemoved: deleted, accountsDeactivated: deactivated }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

/** 샘플 컨설턴트·고객 계정을 만들고, 무작위 비밀번호를 한 번만 돌려준다. */
export async function createSampleAccounts(pool, hashPassword) {
  const cl = await pool.query('select id, name from app_clients where is_sample')
  if (cl.rows.length === 0) throw fail(409, '샘플 고객사가 없습니다. 먼저 샘플 데이터를 넣으세요.')
  const idByKey = {}
  for (const sc of DATA.clients) {
    const row = cl.rows.find((r) => r.name === sc.name)
    if (row) idByKey[sc.key] = row.id
  }
  const created = []
  const skipped = []
  for (const a of DATA.accounts) {
    const dup = await pool.query('select 1 from app_users where username = $1', [a.username])
    if (dup.rows.length) {
      skipped.push(a.username)
      continue
    }
    const password = randomBytes(9).toString('base64url') // 12자, 무작위
    const clientId = a.role === 'client' ? (idByKey[a.clientKey] ?? null) : null
    const { rows } = await pool.query('insert into app_users (username, name, role, client_id, password_hash, is_sample, must_change_password) values ($1, $2, $3, $4, $5, true, false) returning id', [a.username, a.name, a.role, clientId, await hashPassword(password)])
    if (a.role === 'consultant') {
      for (const key of a.ownKeys ?? []) {
        const cid = idByKey[key]
        if (!cid) continue
        await pool.query('update app_clients set owner = $1 where id = $2', [rows[0].id, cid])
        await pool.query('update app_diagnoses set owner = $1 where client_id = $2', [rows[0].id, cid])
      }
    }
    created.push({ username: a.username, name: a.name, role: a.role, password })
  }
  return { created, skipped }
}

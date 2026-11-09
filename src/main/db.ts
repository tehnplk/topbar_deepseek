import { app } from 'electron'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise'
import type { PtInfo } from '../shared/ipc'

// .env lives next to the project in development and in the resources folder
// of a packaged build. Env vars already present in the process win.
loadEnv({
  path: app.isPackaged ? join(process.resourcesPath, '.env') : join(app.getAppPath(), '.env')
})

let pool: Pool | null = null
let poolFailed = false

function getPool(): Pool | null {
  if (pool) return pool
  if (poolFailed) return null

  const host = process.env.DB_HOST
  const name = process.env.DB_NAME

  if (!host || !name) {
    poolFailed = true
    return null
  }

  pool = mysql.createPool({
    host,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: name,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 4),
    waitForConnections: true,
    dateStrings: true,
    charset: 'utf8mb4'
  })

  return pool
}

interface PatientRow extends RowDataPacket {
  hn: string
  pname: string | null
  fname: string | null
  lname: string | null
  full_name: string | null
  sex: string | null
  birthday: string | null
}

function ageFromBirthday(birthday: string): { y: number; m: number; d: number } {
  const [by, bm, bd] = birthday.split('-').map(Number)
  if (!by || !bm || !bd) return { y: 0, m: 0, d: 0 }

  const now = new Date()
  let y = now.getFullYear() - by
  let m = now.getMonth() + 1 - bm
  let d = now.getDate() - bd

  if (d < 0) {
    m -= 1
    d += new Date(now.getFullYear(), now.getMonth(), 0).getDate()
  }
  if (m < 0) {
    y -= 1
    m += 12
  }

  return { y, m, d }
}

/**
 * Patient info for an HN, read from the HOSxP database.
 * Returns null when the database is not configured / the HN does not exist.
 */
export async function getPtInfo(hn: string): Promise<PtInfo | null> {
  const db = getPool()
  if (!db) return null

  const [rows] = await db.query<PatientRow[]>(
    `SELECT hn, pname, fname, lname, full_name, sex, birthday
       FROM patient
      WHERE hn = ?
      LIMIT 1`,
    [hn]
  )

  const row = rows[0]
  if (!row) return null

  const fullname =
    row.full_name?.trim() ||
    `${row.pname ?? ''}${row.fname ?? ''} ${row.lname ?? ''}`.replace(/\s+/g, ' ').trim()

  const sex = row.sex === '1' ? 'ชาย' : row.sex === '2' ? 'หญิง' : ''
  const age = row.birthday ? ageFromBirthday(row.birthday) : { y: 0, m: 0, d: 0 }

  return {
    hn: row.hn,
    fullname,
    sex,
    age,
    ageYmd: `${age.y}-${age.m}-${age.d}`
  }
}

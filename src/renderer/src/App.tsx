import { useEffect, useState } from 'react'
import { ChevronUp, Layers } from 'lucide-react'
import type { AppBarStatus, HosxpState, PtInfo } from '../../shared/ipc'

function App(): React.JSX.Element {
  const [status, setStatus] = useState<AppBarStatus | null>(null)
  const [hosxp, setHosxp] = useState<HosxpState | null>(null)
  const [ptInfo, setPtInfo] = useState<PtInfo | null>(null)

  // Reservation state pushed by the main process (and fetched once on mount).
  useEffect(() => {
    let alive = true
    window.api.appBarStatus().then((next) => {
      if (alive) setStatus(next)
    })
    const unsubscribe = window.api.onAppBarStatus((next) => setStatus(next))
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  // HN of the patient currently open in HOSxP (read through MSAA by main).
  useEffect(() => {
    let alive = true
    window.api.hosxpState().then((next) => {
      if (alive) setHosxp(next)
    })
    const unsubscribe = window.api.onHosxpState((next) => setHosxp(next))
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  // Patient info for the HN that is open in HOSxP (looked up in the DB).
  useEffect(() => {
    const hn = hosxp?.hn
    if (!hn) return

    let alive = true
    window.api
      .ptInfo(hn)
      .then((info) => {
        if (alive) setPtInfo(info)
      })
      .catch(() => {
        if (alive) setPtInfo(null)
      })

    return () => {
      alive = false
    }
  }, [hosxp?.hn])

  // Only show info that belongs to the HN currently open in HOSxP.
  const patient = ptInfo && ptInfo.hn === hosxp?.hn ? ptInfo : null

  const setCollapsed = (collapsed: boolean): void => {
    void window.api.setCollapsed(collapsed).then(setStatus)
  }

  if (status?.collapsed) {
    return (
      <div className="collapsed">
        <button
          type="button"
          className="collapsed-line"
          onClick={() => setCollapsed(false)}
          title="คลิกเพื่อขยายแถบ"
          aria-label="ขยายแถบ"
        />
      </div>
    )
  }

  return (
    <div className="bar">
      <span className="brand-mark" title="topbar_deepseek" aria-label="topbar_deepseek">
        <Layers size={10} strokeWidth={2.6} />
      </span>

      {hosxp?.hn && (
        <span className="hn" title="HN ผู้ป่วยที่เปิดอยู่ใน HOSxP">
          HN : <span className="hn-value">{hosxp.hn}</span>
        </span>
      )}

      {patient && (
        <span className="pt" title="ข้อมูลผู้ป่วยจากฐานข้อมูล HOSxP">
          {patient.fullname} · {patient.sex} · {patient.ageYmd}
        </span>
      )}

      <div className="spacer" />

      <button
        type="button"
        className="icon-btn"
        onClick={() => setCollapsed(true)}
        title="ย่อแถบลงเป็นเส้นตรงกลางจอ"
        aria-label="ย่อแถบ"
      >
        <ChevronUp size={13} />
      </button>
    </div>
  )
}

export default App

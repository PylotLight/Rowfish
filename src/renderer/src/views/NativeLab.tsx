import type { GlassState } from '../../../shared/types'
import Glass from './Glass'
import TrayDemo from './TrayDemo'

export default function NativeLab({ platform, glass, onGlassChange, query }: {
  platform?: NodeJS.Platform
  glass: GlassState | null
  onGlassChange: (state: GlassState) => void
  query: string
}): React.JSX.Element {
  return (
    <section className="native-lab">
      <div className="native-intro card span2">
        <div><span className="section-overline">NATIVE FEATURE CHECKLIST</span><h2>Make the Mac feel native.</h2><p className="muted">Verify translucency, traffic-light spacing, tray behavior and Dock actions on your test Mac. The platform and current material are shown below.</p></div>
        <div className={`native-platform-chip${platform === 'darwin' ? ' is-mac' : ''}`}><span className="platform-orb">{platform === 'darwin' ? '⌘' : '◇'}</span><span><b>{platform === 'darwin' ? 'macOS' : platform ?? 'Detecting'}</b><small>{platform === 'darwin' ? `${glass?.vibrancy ?? 'checking material'} · blur ${glass?.transparent ? 'enabled' : 'off'}` : 'CSS fallback is active'}</small></span></div>
      </div>
      <div className="native-section-title"><div><span className="section-overline">01 — MATERIALS</span><h3>Window vibrancy</h3></div><span className="muted">Click a material, then compare against your desktop background.</span></div>
      <Glass platform={platform} query={query} glass={glass} onGlassChange={onGlassChange} />
      <div className="native-section-title"><div><span className="section-overline">02 — APP LIFECYCLE</span><h3>Tray, Dock &amp; notifications</h3></div><span className="muted">Use the menu-bar icon to restore a hidden window.</span></div>
      <TrayDemo platform={platform} />
    </section>
  )
}

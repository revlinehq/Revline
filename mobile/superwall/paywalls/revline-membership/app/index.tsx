import { useState } from "react";
import { useActions, useIntroductoryOffer, useProducts, usePurchase } from "superwall/hooks";
import logo from "../assets/revline-logo.svg";
import "./membership.css";

const benefits = [
  ["Describe the edit", "Trim, reframe and style your video with a prompt."],
  ["Find your best clips", "Turn longer footage into moments worth sharing."],
  ["Make every word count", "Add readable captions and keep the story moving."],
  ["Give ideas motion", "Create motion graphics in the same workspace."],
];

export default function Membership() {
  const { close, restore, openUrl } = useActions();
  const { getProduct } = useProducts();
  const { eligible } = useIntroductoryOffer();
  const { purchase } = usePurchase();
  const [notice, setNotice] = useState("");
  const price = getProduct("monthly")?.variables.price;
  const ready = typeof price === "string" && price.length > 0 && eligible !== undefined;
  const trial = eligible === true;

  async function start() {
    if (!ready) return;
    setNotice("");
    const result = await purchase("monthly");
    if (result.status === "failed") setNotice("Your purchase could not be completed. Please try again or restore purchases.");
  }

  return (
    <main className="membership">
      <header className="brand-row">
        <div className="brand"><img className="logo" src={logo} alt="" /><span>Revline</span></div>
        <button className="close" aria-label="Close membership" onClick={close}>×</button>
      </header>
      <div className="membership-body">
        <section className="intro">
          <span className="eyebrow">Your next story starts here</span>
          <h1>Just describe<br />the change.</h1>
          <p>Your footage, a few words, a better video.</p>
          <div className="prompt-card" aria-label="Edit by prompt">
            <span className="prompt-label">What should change?</span>
            <p>Cut the pauses. Add captions.<br />Make it ready to share.</p>
            <span className="prompt-result">One workspace, from idea to export</span>
          </div>
        </section>
        <section className="details" aria-label="Membership benefits">
          <ul>{benefits.map(([title, detail]) => <li key={title}><span className="check" aria-hidden="true">✓</span><div><h2>{title}</h2><p>{detail}</p></div></li>)}</ul>
        </section>
      </div>
      <footer className="membership-footer">
        <p className="price">{ready ? trial ? `7 days free, then ${price}/month, cancel anytime` : `${price}/month, cancel anytime` : "Connecting to the App Store…"}</p>
        <button className="primary" disabled={!ready} onClick={start}>{trial ? "Start free trial" : "Continue with monthly membership"}<span aria-hidden="true">↗</span></button>
        <p className="renewal">{trial ? "For eligible new subscribers. " : ""}Renews monthly unless cancelled in Apple subscription settings. Apple confirms the price before purchase.</p>
        {notice && <p role="status" className="notice">{notice}</p>}
        <nav aria-label="Subscription help">
          <button onClick={restore}>Restore purchases</button>
          <button onClick={() => openUrl("https://tryrevline.com/terms")}>Terms</button>
          <button onClick={() => openUrl("https://tryrevline.com/privacy")}>Privacy</button>
        </nav>
      </footer>
    </main>
  );
}

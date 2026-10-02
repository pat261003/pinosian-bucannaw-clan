import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./print.css";

export function reportPages(report) {
  const pages = [],
    byId = new Map(report.people.map((p) => [p.id, p]));
  // Conservative line budgets keep even maximum-length names readable on Letter.
  report.families.forEach((family, unit) => {
    const parentExtra = family.parents.reduce(
      (n, id) =>
        n + Math.max(0, Math.ceil(byId.get(id).full_name.length / 45) - 1),
      0,
    );
    const budget = Math.max(10, 26 - parentExtra);
    let offset = 0;
    do {
      const start = offset,
        children = [];
      let used = 0;
      while (offset < family.children.length && children.length < 5) {
        const id = family.children[offset],
          weight = 4 + Math.ceil(byId.get(id).full_name.length / 45);
        if (children.length && used + weight > budget) break;
        children.push(id);
        used += weight;
        offset++;
      }
      pages.push({
        family,
        unit: unit + 1,
        offset: start,
        children,
        page: pages.length + 2,
      });
    } while (offset < family.children.length);
  });
  return pages;
}
export default function PrintFamily({ api, person, close }) {
  const ref = useRef(),
    [scope, setScope] = useState(person ? "branch" : "all"),
    [report, setReport] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const old = document.activeElement;
    ref.current.showModal();
    return () => old?.focus();
  }, []);
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      setReport(
        await api("/print" + (scope === "branch" ? "?root=" + person.id : "")),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const pages = report ? reportPages(report) : [],
    byId = new Map(report?.people.map((p) => [p.id, p]) || []);
  const familiesFor = (id) =>
    pages.filter((p) => p.offset === 0 && p.family.parents.includes(id));
  const references = (id) => {
    const matches = familiesFor(id);
    return matches.length
      ? "Family sheets: " + matches.map((p) => "p. " + p.page).join(", ")
      : "No further descendants recorded";
  };
  const details = (id) => {
    const p = byId.get(id);
    return (
      <>
        <strong>{p.full_name}</strong>
        <small>
          {p.birth_date ? "Born " + p.birth_date : "Birth date not recorded"} ·{" "}
          {p.gender}
        </small>
      </>
    );
  };
  useEffect(() => {
    if (!report) return;
    document.body.classList.add("family-print-ready");
    return () => document.body.classList.remove("family-print-ready");
  }, [report]);
  const book = report && (
    <>
      <section className="family-print-page print-cover">
        <header>
          <img src="/clan-logo.png" alt="Pinosian Bucannaw Clan" />
          <span>FAMILY RECORD</span>
        </header>
        <h1>{report.title}</h1>
        <p className="print-subtitle">A family booklet to keep and share</p>
        <p>
          {report.member_count} people · {report.families.length} family groups
          · {pages.length + 1} pages
        </p>
        {report.descendant_count !== null && (
          <p>
            {report.descendant_count} descendants of the selected person.
            Partners are also included in the people count.
          </p>
        )}
        <h2>How to follow the family</h2>
        <p>
          Start with Family 1 on page 2. Each sheet places the parent or parents
          above their children. Follow the page references beside a child to
          find their family and continue to the next generation.
        </p>
        <p>
          Large groups continue on another sheet with the parents repeated.
          Children stay in the saved birth order, or automatic birthday/entry
          order. The numbers show their position within this family group.
        </p>
        <p>
          A person with multiple partners has a separate group for each
          partnership. A shared family appears once and can be reached from more
          than one page.
        </p>
        <p>
          Missing names receive a unique “Unknown member” label. Missing
          birthdays and unknown genders are kept as recorded. Notes and
          locations are not printed.
        </p>
        <footer>
          Prepared {report.generated_at.slice(0, 10)} · Page 1 of{" "}
          {pages.length + 1}
        </footer>
      </section>
      {pages.map((sheet) => (
        <section className="family-print-page" key={sheet.page}>
          <header>
            <span>PINOSIAN BUCANNAW CLAN</span>
            <span>
              Family {sheet.unit}
              {sheet.offset > 0 ? " (continued)" : ""}
            </span>
          </header>
          <h2>Parents and children</h2>
          <div className="print-parents">
            {sheet.family.parents.map((id) => (
              <div className="print-person" key={id}>
                {details(id)}
              </div>
            ))}
          </div>
          <div className="print-connector" />
          <h3>
            {sheet.family.parents.length === 2
              ? "Children of both parents"
              : "Children - other parent not recorded"}
          </h3>
          {sheet.children.length ? (
            <ol className="print-children" start={sheet.offset + 1}>
              {sheet.children.map((id, i) => (
                <li key={id}>
                  <span className="print-number">{sheet.offset + i + 1}</span>
                  <div>
                    {details(id)}
                    <span className="print-reference">{references(id)}</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p>No children recorded.</p>
          )}
          {sheet.offset + sheet.children.length <
            sheet.family.children.length && (
            <p className="print-continue">
              More children of these parents on page {sheet.page + 1}.
            </p>
          )}
          <footer>
            Prepared {report.generated_at.slice(0, 10)} · Family {sheet.unit} ·
            Page {sheet.page} of {pages.length + 1}
          </footer>
        </section>
      ))}
    </>
  );
  return createPortal(
    <>
      <dialog
        ref={ref}
        className="print-dialog"
        aria-label="Print family tree"
        onCancel={close}
      >
        <div className="print-toolbar">
          <h2>Print family tree</h2>
          <button onClick={close} aria-label="Close print preview">
            Close
          </button>
        </div>
        <p>
          For a large clan, print a readable family booklet. Each sheet shows
          parents above their children, with page references to follow the next
          generation.
        </p>
        <label>
          What would you like to print?
          <select
            value={scope}
            disabled={busy}
            onChange={(e) => {
              setScope(e.target.value);
              setReport(null);
            }}
          >
            {person && (
              <option value="branch">
                {person.full_name || person.first_name || "This person"} and all
                descendants
              </option>
            )}
            <option value="all">Entire clan - all recorded families</option>
          </select>
        </label>
        <p className="field-help">
          To print Tangaya's branch, close this window, select Tangaya, then
          choose Print family tree. Partners are included, but their unrelated
          branches are not followed.
        </p>
        <button className="primary" disabled={busy} onClick={prepare}>
          {busy
            ? "Preparing all generations…"
            : report
              ? "Refresh preview"
              : "Prepare print preview"}
        </button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {report && (
          <>
            <p role="status">
              {report.member_count} people · {report.families.length} family
              groups · {pages.length + 1} pages.{" "}
              {report.descendant_count !== null &&
                `${report.descendant_count} descendants, plus the starting person and partners.`}
            </p>
            <p>
              <strong>Print settings:</strong> A4 or Letter, portrait, 100%
              scale. Turn browser headers and footers off. Choose your printer
              or “Save as PDF”. Black-and-white printing works well.
            </p>
            <button className="primary" onClick={() => window.print()}>
              Print / Save as PDF
            </button>
            <div className="print-preview" aria-label="Page preview">
              {book}
            </div>
            <p className="field-help">
              Preview is a snapshot of the database. Refresh it if relatives
              have made changes. No names are omitted because a tree branch is
              collapsed.
            </p>
          </>
        )}
      </dialog>
      {report && (
        <div id="family-print-document" aria-label="Printable family booklet">
          {book}
        </div>
      )}
    </>,
    document.body,
  );
}

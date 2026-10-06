import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./print.css";

export function reportPages(report, orientation = "portrait") {
  const landscape = orientation === "landscape",
    columns = landscape ? 2 : 1;
  const fullBudget = landscape ? 165 : 235,
    firstBudget = landscape ? 149 : 219;
  const pages = [],
    byId = new Map(report.people.map((p) => [p.id, p]));
  const memberships = new Map();
  report.families.forEach((f) =>
    f.parents.forEach((id) =>
      memberships.set(id, (memberships.get(id) || 0) + 1),
    ),
  );
  // Millimetre budgets match the compact CSS and leave room for headers/footers on Letter.
  // Estimate with wide characters, including deliberately long unbroken names.
  const nameLines = (id, width) =>
    Math.max(1, Math.ceil(byId.get(id).full_name.length / width));
  const childHeight = (id) =>
    3.6 * nameLines(id, landscape ? 35 : 55) +
    3.2 +
    3.2 *
      Math.max(
        1,
        Math.ceil(
          (15 + (memberships.get(id) || 0) * 10) / (landscape ? 45 : 70),
        ),
      ) +
    2.4;
  let used = 0,
    column = 0;
  const newPage = () => {
    pages.push({ page: pages.length + 1, groups: [] });
    used = 0;
  };
  const nextColumn = () => {
    if (column + 1 < columns) {
      column++;
      used = 0;
    } else {
      column = 0;
      newPage();
    }
  };
  newPage();
  report.families.forEach((family, unit) => {
    const base =
      17 +
      family.parents.reduce(
        (height, id) => height + nameLines(id, landscape ? 40 : 60) * 3.6 + 5,
        0,
      );
    let offset = 0;
    do {
      let page = pages.at(-1),
        budget = page.page === 1 ? firstBudget : fullBudget;
      const remaining =
        base +
        family.children
          .slice(offset)
          .reduce((height, id) => height + childHeight(id), 0);
      // Keep small families together rather than repeat their parents for one leftover child.
      const minimum =
        remaining <= fullBudget
          ? remaining
          : base +
            (family.children.length ? childHeight(family.children[offset]) : 5);
      if (
        page.groups.some((g) => g.column === column) &&
        used + minimum > budget
      ) {
        nextColumn();
        page = pages.at(-1);
        budget = page.page === 1 ? firstBudget : fullBudget;
      }
      const group = {
        family,
        unit: unit + 1,
        offset,
        children: [],
        page: page.page,
        column,
      };
      let height = base;
      while (offset < family.children.length) {
        const id = family.children[offset],
          extra = childHeight(id);
        if (group.children.length && used + height + extra > budget) break;
        group.children.push(id);
        height += extra;
        offset++;
      }
      if (!group.children.length) height += 5;
      page.groups.push(group);
      used += height;
    } while (offset < family.children.length);
  });
  return pages;
}
export default function PrintFamily({ api, person, close }) {
  const ref = useRef(),
    [paper, setPaper] = useState("A4"),
    [orientation, setOrientation] = useState("portrait"),
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
  const pages = report ? reportPages(report, orientation) : [],
    byId = new Map(report?.people.map((p) => [p.id, p]) || []);
  const familiesFor = (id) =>
    pages
      .flatMap((p) => p.groups)
      .filter((p) => p.offset === 0 && p.family.parents.includes(id));
  const references = (id) => {
    const matches = familiesFor(id);
    return matches.length
      ? "Family sheets: " +
          [...new Set(matches.map((p) => p.page))]
            .map((page) => "p. " + page)
            .join(", ")
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
      {pages.map((page) => (
        <section className="family-print-page" key={page.page}>
          <header>
            <span>PINOSIAN BUCANNAW CLAN</span>
            <span>Family record</span>
          </header>
          {page.page === 1 && (
            <div className="print-intro">
              <h1>{report.title}</h1>
              <p>
                {report.member_count} people · {report.families.length} family
                groups · {pages.length} pages
              </p>
              <p>
                Parents appear above their children. Follow a child's page
                reference to find their family.
              </p>
            </div>
          )}
          <div className="print-groups">
            {Array.from(
              { length: orientation === "landscape" ? 2 : 1 },
              (_, column) => (
                <div className="print-column" key={column}>
                  {page.groups
                    .filter((g) => g.column === column)
                    .map((sheet) => (
                      <section
                        className="print-family-group"
                        key={sheet.unit + "-" + sheet.offset}
                      >
                        <h2>
                          Family {sheet.unit}
                          {sheet.offset > 0 ? " (continued)" : ""} · Parents and
                          children
                        </h2>
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
                          <ol
                            className="print-children"
                            start={sheet.offset + 1}
                          >
                            {sheet.children.map((id, i) => (
                              <li key={id}>
                                <span className="print-number">
                                  {sheet.offset + i + 1}
                                </span>
                                <div>
                                  {details(id)}
                                  <span className="print-reference">
                                    {references(id)}
                                  </span>
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
                            More children of these parents on page{" "}
                            {
                              pages
                                .flatMap((p) => p.groups)
                                .find(
                                  (g) =>
                                    g.unit === sheet.unit &&
                                    g.offset ===
                                      sheet.offset + sheet.children.length,
                                )?.page
                            }
                            .
                          </p>
                        )}
                      </section>
                    ))}
                </div>
              ),
            )}
          </div>
          <footer>
            Prepared {report.generated_at.slice(0, 10)} · Page {page.page} of{" "}
            {pages.length}
          </footer>
        </section>
      ))}
    </>
  );
  return createPortal(
    <>
      <style>{`@page { size: ${paper} ${orientation}; margin: 12mm; }`}</style>
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
          Print a compact family record. Several family groups can share a
          sheet, with page references to follow each generation.
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
        <label>
          Paper size
          <select
            aria-label="Paper size"
            value={paper}
            onChange={(e) => setPaper(e.target.value)}
          >
            <option value="A4">A4</option>
            <option value="Letter">Letter (short bond paper)</option>
          </select>
        </label>
        <label>
          Page orientation
          <select
            aria-label="Page orientation"
            value={orientation}
            onChange={(e) => setOrientation(e.target.value)}
          >
            <option value="portrait">Portrait (tall page)</option>
            <option value="landscape">
              Landscape (wide page, two columns)
            </option>
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
              groups · {pages.length} pages.{" "}
              {report.descendant_count !== null &&
                `${report.descendant_count} descendants, plus the starting person and partners.`}
            </p>
            <p>
              <strong>Print settings:</strong> {paper}, {orientation}, 100%
              scale. Turn browser headers and footers off. Choose your printer
              or “Save as PDF”. Black-and-white printing works well.
            </p>
            <button className="primary" onClick={() => window.print()}>
              Print / Save as PDF
            </button>
            <div
              className={"print-preview print-" + orientation}
              aria-label="Page preview"
            >
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
        <div
          id="family-print-document"
          className={"print-" + orientation}
          aria-label="Printable family booklet"
        >
          {book}
        </div>
      )}
    </>,
    document.body,
  );
}

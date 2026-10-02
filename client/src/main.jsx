import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  GitFork,
  Users,
  Search,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  X,
  Heart,
  MapPin,
  Calendar,
  ZoomIn,
  ZoomOut,
  Maximize,
  Leaf,
  Network,
  BookOpen,
  Check,
  RefreshCw,
  Trash2,
  Link as LinkIcon,
} from "lucide-react";

import "./style.css";
import HierarchyTree from "./HierarchyTree.jsx";
const API = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
async function api(path, options = {}) {
  const r = await fetch(API + "/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error(
      "The server returned an unexpected response. Check the API address.",
    );
  }
  if (!r.ok)
    throw Object.assign(new Error(data.error || "Request failed."), data, {
      status: r.status,
    });
  return data;
}
const name = (p) =>
  p?.full_name ||
  [p?.first_name, p?.middle_name, p?.last_name, p?.suffix]
    .filter(Boolean)
    .join(" ") ||
  `Unknown member · ${p?.id?.slice(0, 8) || "new"}`;
const date = (s) =>
  s
    ? new Date(s.slice(0, 10) + "T00:00:00").toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "Not recorded";
function Avatar({ person, large = false }) {
  return (
    <span
      className={
        "avatar " +
        (large ? "large " : "") +
        (person?.gender === "Female" ? "rose" : "")
      }
    >
      {person?.first_name?.[0]}
      {person?.last_name?.[0]}
      {!person?.first_name && !person?.last_name && "?"}
    </span>
  );
}
function Modal({ title, close, children }) {
  const ref = useRef();
  useEffect(() => {
    const old = document.activeElement;
    ref.current.showModal();
    return () => old?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon" aria-label="Close dialog" onClick={close}>
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function App() {
  const [treeStyle, setTreeStyle] = useState("generations");
  const [stats, setStats] = useState(null),
    [list, setList] = useState({ items: [], total: 0 }),
    [view, setView] = useState("tree"),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState(null),
    [tree, setTree] = useState(null),
    [unionId, setUnionId] = useState(""),
    [childOffset, setChildOffset] = useState(0),
    [modal, setModal] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [version, setVersion] = useState(0),
    [loading, setLoading] = useState(true),
    [branch, setBranch] = useState(""),
    [branches, setBranches] = useState([]);
  const [heads, setHeads] = useState([]);
  const refresh = () => setVersion((v) => v + 1);
  const initialFocus = useRef(false);
  useEffect(() => {
    let live = true,
      lastRevision = null;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const { revision } = await api("/revision");
        if (!live) return;
        if (lastRevision !== null && lastRevision !== revision)
          setVersion((v) => v + 1);
        lastRevision = revision;
      } catch {
        /* Normal data requests show connection errors. */
      }
    };
    check();
    const timer = setInterval(check, 10000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const timer = setTimeout(
      () =>
        Promise.all([
          api("/stats"),
          api(
            `/persons?q=${encodeURIComponent(query)}&offset=${offset}&limit=24${view === "branches" ? "&roots=true" : ""}${branch ? "&branch=" + branch : ""}`,
          ),
          api("/branches?limit=100"),
          api("/heads"),
        ])
          .then(([s, l, b, heads]) => {
            if (live) {
              setStats(s);
              setList(l);
              setBranches(b.items);
              setHeads(heads);
              if (!initialFocus.current) {
                initialFocus.current = true;
                if (heads.length && view === "tree" && !selected)
                  setSelected(heads[0].id);
              }
              setError("");
            }
          })
          .catch((e) => {
            if (live) {
              setError(e.message);
            }
          })
          .finally(() => {
            if (live) setLoading(false);
          }),
      180,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, offset, view, version, branch]);
  useEffect(() => {
    if (!selected) {
      setTree(null);
      return;
    }
    let live = true;
    api(`/tree/${selected}?union=${unionId}&offset=${childOffset}&limit=12`)
      .then((t) => {
        if (live) setTree(t);
      })
      .catch((e) => {
        if (!live) return;
        if (e.status === 404) {
          setTree(null);
          setSelected(null);
          setNotice(
            "This person has been removed from the shared family tree.",
          );
        } else setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [selected, unionId, childOffset, version]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  const focus = (id) => {
    setSelected(id);
    setUnionId("");
    setChildOffset(0);
    setView("tree");
    setQuery("");
    setError("");
  };
  const add = (relation = null, other = null) => {
    setModal(
      relation
        ? { type: "person", relation, person: tree?.person, other }
        : { type: "choose", person: tree?.person },
    );
  };
  const saved = (p) => {
    setModal(null);
    refresh();
    if (p?.id) focus(p.id);
    setNotice("Saved to the family tree. Everyone can see this update.");
  };
  const p = tree?.person;
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Pinosian Bucannaw Clan home">
          <img src="/clan-logo.png" alt="Pinosian Bucannaw Clan" />
        </a>
        <div className="workspace-label">YOUR FAMILY SPACE</div>
        <nav>
          {[
            ["tree", GitFork, "Family tree"],
            ["members", Users, "All members"],
            ["branches", Network, "Family branches"],
          ].map(([id, Icon, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => {
                setView(id);
                setOffset(0);
                setBranch("");
                setQuery("");
              }}
            >
              <Icon size={19} />
              {label}
              {id === "members" && (
                <span className="nav-count">{stats?.members ?? "—"}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="side-note">
          <Leaf size={25} />
          <h3>
            Every connection
            <br />
            has a story.
          </h3>
          <p>
            A living record of the people
            <br />
            who make you, you.
          </p>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <img
            className="mobile-clan-brand"
            src="/clan-logo.png"
            alt="Pinosian Bucannaw Clan"
          />
          <div className="breadcrumb">
            Our family <ChevronRight size={14} />{" "}
            <strong>
              {view === "tree"
                ? "Family tree"
                : view === "members"
                  ? "All members"
                  : "Family branches"}
            </strong>
          </div>
          <span className="connection">
            <i />
            Shared clan tree
          </span>
        </header>
        <section className="page-heading">
          <div>
            <div className="eyebrow">PINOSIAN BUCANNAW CLAN</div>
            <h1>
              {view === "tree"
                ? "Our family tree"
                : view === "members"
                  ? "The people in our story"
                  : "Where our stories begin"}
            </h1>
            <p>
              {view === "tree"
                ? "Every generation, every branch, one family."
                : view === "members"
                  ? "Find a familiar name. Discover a new connection."
                  : "Explore family roots, traced through parenthood."}
            </p>
          </div>
          <button className="primary" onClick={() => add()}>
            <Plus size={18} /> Add family member
          </button>
        </section>
        <section
          className="getting-started"
          aria-label="How to add your family"
        >
          <div>
            <strong>Add your part of the family</strong>
            <p>
              Find someone you know, then add their child, parent, or partner.
              You can fill in missing details later.
            </p>
          </div>
          <button
            onClick={() => {
              setView("members");
              setQuery("");
              setOffset(0);
              setTimeout(
                () => document.querySelector(".search input")?.focus(),
                0,
              );
            }}
          >
            <Search size={17} />
            Find a person
          </button>
          {heads.length > 0 && (
            <button onClick={() => focus(heads[0].id)}>
              <GitFork size={17} />
              Back to clan heads
            </button>
          )}
        </section>
        <section className="stats">
          {[
            [Users, "Family members", stats?.members],
            [Heart, "Partnerships", stats?.unions],
            [GitFork, "Generations", stats?.generations],
            [Network, "Family roots", stats?.branches],
          ].map(([Icon, label, value]) => (
            <div key={label}>
              <span className="stat-icon">
                <Icon size={19} />
              </span>
              <div>
                <strong>{value ?? "—"}</strong>
                <span>{label}</span>
              </div>
            </div>
          ))}
        </section>
        <section className="workspace">
          <div className="toolbar">
            <div className="view-tabs">
              <button
                className={view === "tree" ? "selected" : ""}
                onClick={() => setView("tree")}
              >
                <GitFork size={17} />
                Tree view
              </button>
              <button
                className={view === "members" ? "selected" : ""}
                onClick={() => {
                  setView("members");
                  setOffset(0);
                }}
              >
                <Users size={17} />
                Find a person
              </button>
            </div>
            <label className="search">
              <Search size={18} />
              <input
                placeholder="Search your family…"
                aria-label="Search family members"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOffset(0);
                }}
              />
              {query && (
                <button
                  className="icon"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                >
                  <X size={15} />
                </button>
              )}
            </label>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={refresh}>
                <RefreshCw size={15} />
                Try again
              </button>
            </div>
          )}
          {loading && !stats ? (
            <div className="loading">Gathering your family connections…</div>
          ) : stats?.members === 0 && !error ? (
            <div className="empty">
              <div className="empty-art">
                <span className="twig t1" />
                <span className="twig t2" />
                <span className="twig t3" />
                <span className="art-node n1">
                  <Users size={25} />
                </span>
                <span className="art-node n2">
                  <Heart size={18} />
                </span>
                <span className="art-node n3">
                  <Leaf size={21} />
                </span>
                <span className="art-node n4">
                  <Plus size={18} />
                </span>
              </div>
              <span className="eyebrow">EVERY FAMILY STARTS WITH SOMEONE</span>
              <h2>Start Your Family Tree</h2>
              <p>
                No family members have been added yet.
                <br />
                Add your first family member and let your story grow.
              </p>
              <button className="primary" onClick={() => add()}>
                <Plus size={18} /> Add First Family Member
              </button>
              <span className="empty-hint">
                Begin with yourself, a parent, or a family head.
              </span>
            </div>
          ) : view === "tree" && selected && !query ? (
            <div className="explorer">
              <div className="tree-area">
                <div className="tree-caption">
                  <button
                    className="text-button"
                    onClick={() => setSelected(null)}
                  >
                    <ArrowLeft size={16} /> All family members
                  </button>
                  <span>TAP A PERSON TO EXPLORE</span>
                </div>
                {tree ? (
                  <>
                    <div className="focus-actions">
                      <div>
                        <small>You are viewing</small>
                        <strong>{name(p)}</strong>
                      </div>
                      <button className="primary" onClick={() => add()}>
                        <Plus size={16} />
                        Add a relative
                      </button>
                      <button
                        onClick={() =>
                          document
                            .querySelector(".person-detail")
                            ?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            })
                        }
                      >
                        See their details <ChevronDown size={15} />
                      </button>
                    </div>
                    <div className="tree-style-tabs" aria-label="Tree display">
                      <button
                        className={
                          treeStyle === "generations" ? "selected" : ""
                        }
                        onClick={() => setTreeStyle("generations")}
                      >
                        Generation tree
                      </button>
                      <button
                        className={treeStyle === "outline" ? "selected" : ""}
                        onClick={() => setTreeStyle("outline")}
                      >
                        Simple tree
                      </button>
                    </div>
                    {!p.branches.some((id) => heads.some((h) => h.id === id)) &&
                      !p.is_clan_head && (
                        <p className="field-help">
                          This person is not yet linked as a descendant of the
                          clan heads. Use their details to add or correct their
                          parents.
                        </p>
                      )}
                    <HierarchyTree
                      root={heads[0]}
                      selected={p.id}
                      ancestors={p.ancestor_ids}
                      style={treeStyle}
                      version={version}
                      api={api}
                      focus={focus}
                    />
                    <div className="canvas-legend">
                      <span>
                        <i /> Parent & child
                      </span>
                      <span>
                        <i className="partner-line" /> Partnership
                      </span>
                      <small>
                        {treeStyle === "outline"
                          ? "Open arrows to explore"
                          : "Drag to explore · Pinch to zoom"}
                      </small>
                    </div>
                  </>
                ) : (
                  <div className="loading">Loading this family…</div>
                )}
              </div>
              {p && (
                <aside className="person-detail">
                  <div className="person-top">
                    <Avatar person={p} large />
                    <button
                      className="text-button"
                      onClick={() => setModal({ type: "person", edit: p })}
                    >
                      Edit <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <h2>{name(p)}</h2>
                  {!p.is_clan_head && (
                    <div className="person-corrections">
                      <button
                        onClick={() => setModal({ type: "move", person: p })}
                      >
                        <GitFork size={17} />
                        Change parents / family
                      </button>
                      <button
                        className="delete-person"
                        onClick={() => setModal({ type: "delete", person: p })}
                      >
                        <Trash2 size={17} />
                        Delete person
                      </button>
                    </div>
                  )}
                  <span className="tag">Generation {p.generation}</span>
                  <div className="facts">
                    <span>
                      <Calendar size={16} />
                      {date(p.birth_date)}
                    </span>
                    <span>
                      <Users size={16} />
                      {p.gender}
                    </span>
                    <span>
                      <MapPin size={16} />
                      {p.current_location || "Location not recorded"}
                    </span>
                  </div>
                  <div className="relative-actions">
                    <span className="section-label">ADD RELATIVE</span>
                    <div>
                      <button onClick={() => add("child")}>
                        <Plus size={14} />
                        Child
                      </button>
                      {!p.is_clan_head && (
                        <button onClick={() => add("parent")}>
                          <Plus size={14} />
                          Parent
                        </button>
                      )}
                      {!p.is_clan_head && (
                        <button onClick={() => add("spouse")}>
                          <Plus size={14} />
                          Partner
                        </button>
                      )}
                    </div>
                  </div>
                  <DetailSection title="Parents">
                    {p.parents.length ? (
                      p.parents.map((parent) => (
                        <div className="parent-row" key={parent.id}>
                          <button
                            className="person-link"
                            onClick={() => focus(parent.id)}
                          >
                            {name(parent)}
                            <ChevronRight size={15} />
                          </button>
                          {!parent.is_clan_head && (
                            <button
                              className="icon"
                              aria-label={
                                "Remove parent link to " + name(parent)
                              }
                              onClick={() =>
                                setModal({
                                  type: "remove",
                                  id: parent.relationship_id,
                                })
                              }
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="muted">No parents recorded · Family root</p>
                    )}
                  </DetailSection>
                  <DetailSection
                    title={`Spouses / Partners (${p.families.filter((f) => f.partner).length})`}
                  >
                    {p.families.length ? (
                      p.families.map((f) => (
                        <div className="family-card" key={f.id || "single"}>
                          {f.partner ? (
                            <button
                              className="person-link"
                              onClick={() => focus(f.partner.id)}
                            >
                              {name(f.partner)}
                              <ArrowUpRight size={14} />
                            </button>
                          ) : (
                            <strong>One known parent</strong>
                          )}
                          <FamilyChildren
                            key={p.id + String(f.id) + version}
                            family={f}
                            personId={p.id}
                            focus={focus}
                          />
                          <div>
                            <button
                              onClick={() => {
                                setTreeStyle("outline");
                                document
                                  .querySelector(".hierarchy-view")
                                  ?.scrollIntoView({ behavior: "smooth" });
                              }}
                            >
                              See their children
                            </button>
                            <button
                              onClick={() =>
                                add("child", f.partner?.id || "single")
                              }
                            >
                              <Plus size={13} />
                              Add child
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="muted">No partnerships recorded.</p>
                    )}
                  </DetailSection>
                  <DetailSection title="Family roots">
                    <p className="muted">
                      {p.branch_names.map((b) => b.name).join(" · ")}
                    </p>
                  </DetailSection>
                  <DetailSection title="Birth place">
                    <p className="muted">{p.birth_place || "Not recorded"}</p>
                  </DetailSection>
                  {p.notes && (
                    <DetailSection title="Notes">
                      <p className="notes">{p.notes}</p>
                    </DetailSection>
                  )}
                </aside>
              )}
            </div>
          ) : (
            <div className="directory">
              <div className="directory-head">
                <div>
                  <h2>
                    {query
                      ? "Search results"
                      : view === "branches"
                        ? "Family roots"
                        : "Find your place in the family"}
                  </h2>
                  <p>
                    {list.total} {list.total === 1 ? "person" : "people"}
                    {query
                      ? " matching your search"
                      : view === "branches"
                        ? " with no recorded parents"
                        : " in your collection"}
                  </p>
                </div>
                {view !== "branches" && (
                  <select
                    aria-label="Filter by family root"
                    value={branch}
                    onChange={(e) => {
                      setBranch(e.target.value);
                      setOffset(0);
                    }}
                  >
                    <option value="">All family roots</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {name(b)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="member-grid">
                {list.items.map((person) => (
                  <button
                    className="member-card"
                    key={person.id}
                    onClick={() => focus(person.id)}
                  >
                    <Avatar person={person} />
                    <div>
                      <strong>{name(person)}</strong>
                      <span>{date(person.birth_date)}</span>
                      <small>
                        Generation {person.generation} ·{" "}
                        {person.branches.length}{" "}
                        {person.branches.length === 1 ? "root" : "roots"}
                      </small>
                    </div>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
              {list.total === 0 && (
                <p className="no-results">
                  No matching family members. Try another name.
                </p>
              )}
              <Pager
                offset={offset}
                total={list.total}
                size={24}
                change={setOffset}
              />
            </div>
          )}
          <div className="workspace-footer">
            <span>
              <Leaf size={14} /> A little history. A lot of belonging.
            </span>
            <span>Made for the generations to come.</span>
          </div>
        </section>
        <footer className="page-footer">
          <span>
            Pinosian Bucannaw <span>Our clan, connected.</span>
          </span>
          <button onClick={() => setModal({ type: "guide" })}>
            <BookOpen size={15} /> A guide to your tree
          </button>
        </footer>
      </main>
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}

      {modal?.type === "choose" && (
        <AddChooser
          person={modal.person}
          close={() => setModal(null)}
          choose={(person, relation) =>
            setModal({ type: "person", person, relation })
          }
        />
      )}
      {modal?.type === "delete" && (
        <DeletePerson
          person={modal.person}
          close={() => setModal(null)}
          done={() => {
            setModal(null);
            setSelected(null);
            setTree(null);
            setQuery("");
            setOffset(0);
            setView("members");
            refresh();
            setNotice(
              "Person deleted. Their other relatives are still in the tree.",
            );
          }}
        />
      )}
      {modal?.type === "move" && (
        <MovePerson
          person={modal.person}
          close={() => setModal(null)}
          done={() => {
            setModal(null);
            refresh();
            setNotice(
              "Family connection corrected. Their children and partners are unchanged.",
            );
          }}
        />
      )}
      {modal?.type === "person" && (
        <PersonForm
          {...modal}
          close={() => {
            setModal(null);
            refresh();
          }}
          saved={saved}
          focus={(id) => {
            setModal(null);
            focus(id);
          }}
        />
      )}
      {modal?.type === "remove" && (
        <RemoveLink
          id={modal.id}
          close={() => setModal(null)}
          done={() => saved()}
        />
      )}
      {modal?.type === "guide" && (
        <Modal title="A guide to your tree" close={() => setModal(null)}>
          <div className="guide">
            <p>
              Start with a family head, then open their card to add parents,
              children, or partners. You can connect an existing person or
              create someone new.
            </p>
            <h3>One family unit at a time</h3>
            <p>
              Choose a partner to see only the children recorded with that
              person. “One known parent” keeps children whose other parent is
              unknown in a separate group.
            </p>
            <h3>Explore at your own pace</h3>
            <p>
              The clan heads stay at the top. Select a person to see their
              details. Use Simple tree to open branches like folders. Drag the
              generation tree, pinch on touchscreens, or use the zoom buttons.
              Large families appear in pages of 12 children.
            </p>
            <h3>Roots and generations</h3>
            <p>
              Roots are people with no recorded parents. Generations follow the
              longest recorded parent-child path; partnerships never change
              ancestry. A person can descend from more than one root.
            </p>
            <h3>Keep your connections accurate</h3>
            <p>
              Add a missing second parent from a child’s profile. To correct a
              parent, remove the incorrect link before adding the right person.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
function DetailSection({ title, children }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
function Pager({ offset, total, size, change }) {
  return total > size ? (
    <div className="pager">
      <button
        disabled={!offset}
        onClick={() => change(Math.max(0, offset - size))}
      >
        Previous
      </button>
      <span>
        {offset + 1}–{Math.min(offset + size, total)} of {total}
      </span>
      <button
        disabled={offset + size >= total}
        onClick={() => change(offset + size)}
      >
        Next
      </button>
    </div>
  ) : null;
}
function FamilyChildren({ family, personId, focus }) {
  const [open, setOpen] = useState(false),
    [result, setResult] = useState(null),
    [offset, setOffset] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    api(
      `/persons/${personId}/children?union=${family.id || "single"}&offset=${offset}&limit=10`,
    )
      .then((r) => {
        if (live) {
          setResult(r);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [open, offset, personId, family.id]);
  return (
    <section className="family-children">
      <button
        className="children-toggle"
        disabled={!family.child_count}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {family.child_count} {family.child_count === 1 ? "child" : "children"}
        {family.partner ? " together" : ""}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div>
          {error ? (
            <p role="alert">{error}</p>
          ) : result ? (
            <>
              {result.items.map((c) => (
                <button
                  className="person-link"
                  key={c.id}
                  onClick={() => focus(c.id)}
                >
                  {name(c)}
                  <ChevronRight size={12} />
                </button>
              ))}
              <Pager
                offset={offset}
                total={result.total}
                size={10}
                change={setOffset}
              />
            </>
          ) : (
            <p>Loading children…</p>
          )}
        </div>
      )}
    </section>
  );
}
function PersonPicker({ value, onChange, exclude = [] }) {
  const [q, setQ] = useState(""),
    [results, setResults] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        api("/search?q=" + encodeURIComponent(q) + "&limit=20")
          .then((r) => {
            if (live) {
              setResults(r.items);
              setError("");
            }
          })
          .catch((e) => {
            if (live) setError(e.message);
          }),
      200,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <div className="picker">
      <label>
        Find an existing member
        <input
          placeholder="Search by name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="picker-results">
        {results
          .filter((p) => !exclude.includes(p.id))
          .map((p) => (
            <button
              type="button"
              className={value === p.id ? "picked" : ""}
              key={p.id}
              onClick={() => onChange(p.id)}
            >
              {name(p)}
              <small>{date(p.birth_date)}</small>
              {value === p.id && <Check size={15} />}
            </button>
          ))}
      </div>
    </div>
  );
}
function AddChooser({ person, close, choose }) {
  const [headIds, setHeadIds] = useState([]);
  useEffect(() => {
    api("/heads")
      .then((h) => setHeadIds(h.map((p) => p.id)))
      .catch(() => {});
  }, []);
  const [selected, setSelected] = useState(person?.id || ""),
    [changing, setChanging] = useState(!person),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const proceed = async (relation) => {
    setBusy(true);
    setError("");
    try {
      choose(await api("/persons/" + selected), relation);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Who would you like to add?" close={close}>
      <p className="form-intro">
        Start with someone already in the tree. This keeps your family connected
        to the right people.
      </p>
      {changing ? (
        <PersonPicker value={selected} onChange={setSelected} />
      ) : (
        <div className="chosen-person">
          <Avatar person={person} />
          <strong>{name(person)}</strong>
          <button onClick={() => setChanging(true)}>Choose someone else</button>
        </div>
      )}
      <p className="choice-question">The person I want to add is their…</p>
      <div className="relationship-options">
        {[
          ["child", "Child", "Their son or daughter"],
          ["parent", "Parent", "Their mother or father"],
          ["spouse", "Partner", "Their husband, wife, or partner"],
        ]
          .filter(
            ([type]) =>
              type === "child" ||
              !(
                headIds.includes(selected) ||
                (selected === person?.id && person?.is_clan_head)
              ),
          )
          .map(([type, label, help]) => (
            <button
              key={type}
              disabled={!selected || busy}
              onClick={() => proceed(type)}
            >
              <Plus size={18} />
              <span>
                <strong>{label}</strong>
                <small>{help}</small>
              </span>
              <ChevronRight size={18} />
            </button>
          ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="standalone-add" onClick={() => choose(null, null)}>
        I don’t know their family connection yet
      </button>
      <p className="muted">
        This adds a separate person. You can connect them to relatives later.
      </p>
    </Modal>
  );
}
function PersonForm({ close, saved, focus, edit, relation, person, other }) {
  const [values, setValues] = useState(
      edit || {
        first_name: "",
        middle_name: "",
        last_name: "",
        suffix: "",
        birth_date: "",
        gender: "",
        birth_place: "",
        current_location: "",
        notes: "",
      },
    ),
    [mode, setMode] = useState("new"),
    [existing, setExisting] = useState(""),
    [otherParent, setOtherParent] = useState(
      person?.is_clan_head
        ? person.families.find((f) => f.partner)?.partner.id || ""
        : other || "",
    ),
    [newParent, setNewParent] = useState(false),
    [families, setFamilies] = useState(person?.families || []),
    [error, setError] = useState(""),
    [duplicates, setDuplicates] = useState([]),
    [busy, setBusy] = useState(false);
  async function submit(allow = false) {
    setError("");
    if (relation === "child" && !otherParent) {
      setError("Choose the other parent, or select No other parent / Unknown.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "existing") {
        if (!existing) throw Error("Select a family member.");
        if (relation === "spouse")
          await api("/unions", {
            method: "POST",
            body: JSON.stringify({
              person1_id: person.id,
              person2_id: existing,
            }),
          });
        else
          await api("/relationships/parent-child", {
            method: "POST",
            body: JSON.stringify({
              parent_id: relation === "parent" ? existing : person.id,
              child_id: relation === "parent" ? person.id : existing,
              ...(relation === "child" && otherParent !== "single"
                ? { other_parent_id: otherParent }
                : {}),
            }),
          });
        saved({ id: person.id });
      } else {
        const result = await api(edit ? "/persons/" + edit.id : "/persons", {
          method: edit ? "PUT" : "POST",
          body: JSON.stringify({
            ...values,
            allow_duplicate: allow,
            ...(relation
              ? {
                  relation: {
                    type: relation,
                    person_id: person.id,
                    ...(relation === "child" && otherParent !== "single"
                      ? { other_parent_id: otherParent }
                      : {}),
                  },
                }
              : {}),
          }),
        });
        saved(result);
      }
    } catch (e) {
      setError(e.message);
      setDuplicates(e.duplicates || []);
    } finally {
      setBusy(false);
    }
  }
  const title = edit
    ? "Edit family member"
    : relation === "child"
      ? "Add a child"
      : relation === "parent"
        ? "Add a parent"
        : relation === "spouse"
          ? "Add a spouse / partner"
          : "Add a family member";
  return (
    <Modal title={title} close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="form-intro">
          {relation ? (
            <>
              A new connection for <strong>{name(person)}</strong>.
            </>
          ) : (
            "Add what you know. Names and birth date can be left blank and completed later. Gender is required."
          )}
        </p>
        <p className="field-help">
          Only gender is required. Leave any name or birthday you don’t know
          blank.
        </p>
        {relation && (
          <div className="segmented">
            <button
              type="button"
              className={mode === "new" ? "chosen" : ""}
              onClick={() => setMode("new")}
            >
              <Plus size={15} />
              Add someone new
            </button>
            <button
              type="button"
              className={mode === "existing" ? "chosen" : ""}
              onClick={() => setMode("existing")}
            >
              <LinkIcon size={15} />
              Already in the tree
            </button>
          </div>
        )}
        {relation === "child" && person?.is_clan_head && (
          <div className="parent-choice">
            <strong>
              Child of {name(person)} and{" "}
              {name(person.families.find((f) => f.partner)?.partner)}
            </strong>
            <p>This child will automatically be added under both clan heads.</p>
          </div>
        )}
        {relation === "child" && !person?.is_clan_head && (
          <div className="parent-choice">
            <label>
              Who is the other parent? <span>*</span>
              <select
                required
                value={otherParent}
                onChange={(e) => {
                  if (e.target.value === "new") {
                    setNewParent(true);
                  } else setOtherParent(e.target.value);
                }}
              >
                <option value="" disabled>
                  Choose the correct parent
                </option>
                {families
                  .filter((f) => f.partner)
                  .map((f) => (
                    <option key={f.partner.id} value={f.partner.id}>
                      {name(f.partner)}
                    </option>
                  ))}
                <option value="single">No other parent / Unknown</option>
                <option value="new">+ Add New Spouse/Parent</option>
              </select>
            </label>
            <p>
              {otherParent && otherParent !== "single"
                ? `Parents: ${name(person)} and ${name(families.find((f) => f.partner?.id === otherParent)?.partner)}.`
                : `${name(person)} will be recorded as a parent. Choose “No other parent / Unknown” if you’re unsure.`}
            </p>
          </div>
        )}
        {mode === "existing" ? (
          <PersonPicker
            value={existing}
            onChange={setExisting}
            exclude={[person.id]}
          />
        ) : (
          <>
            <div className="form-grid">
              {[
                ["first_name", "First name"],
                ["last_name", "Last name"],
              ].map(([key, label, required]) => (
                <label key={key}>
                  {label}
                  {required && <span> *</span>}
                  <input
                    required={required}
                    maxLength={key === "suffix" ? 30 : 100}
                    value={values[key] || ""}
                    onChange={(e) =>
                      setValues({ ...values, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label>
                Birth date <span className="optional">optional</span>
                <input
                  type="date"
                  min="0001-01-01"
                  max={new Date().toISOString().slice(0, 10)}
                  value={values.birth_date?.slice(0, 10) || ""}
                  onChange={(e) =>
                    setValues({ ...values, birth_date: e.target.value })
                  }
                />
              </label>
              <label>
                Gender <span>*</span>
                <select
                  required
                  value={values.gender}
                  onChange={(e) =>
                    setValues({ ...values, gender: e.target.value })
                  }
                >
                  <option value="" disabled>
                    Select gender
                  </option>
                  {["Male", "Female", "Other", "Unknown"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <details
              className="optional-details"
              open={
                (edit &&
                  (!!values.notes ||
                    !!values.middle_name ||
                    !!values.suffix ||
                    !!values.birth_place ||
                    !!values.current_location)) ||
                undefined
              }
            >
              <summary>
                More details <span>optional</span>
              </summary>
              <div className="form-grid">
                {[
                  ["middle_name", "Middle name"],
                  ["suffix", "Suffix (for example, Jr.)"],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      maxLength={key === "suffix" ? 30 : 100}
                      value={values[key] || ""}
                      onChange={(e) =>
                        setValues({ ...values, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label>
                  Birth place
                  <input
                    maxLength={200}
                    value={values.birth_place || ""}
                    onChange={(e) =>
                      setValues({ ...values, birth_place: e.target.value })
                    }
                  />
                </label>
                <label>
                  Current location
                  <input
                    maxLength={200}
                    value={values.current_location || ""}
                    onChange={(e) =>
                      setValues({ ...values, current_location: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                Notes <span className="optional">optional</span>
                <textarea
                  rows={3}
                  maxLength={5000}
                  placeholder="A memory, a story, a little more about them…"
                  value={values.notes || ""}
                  onChange={(e) =>
                    setValues({ ...values, notes: e.target.value })
                  }
                />
              </label>
            </details>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {duplicates.length > 0 && (
          <div className="duplicates">
            <h3>Possible Existing Family Member</h3>
            {duplicates.map((d) => (
              <div key={d.id}>
                <strong>{name(d)}</strong>
                <p>
                  {date(d.birth_date)} · Parents:{" "}
                  {d.parents?.map(name).join(" & ") || "Not recorded"}
                </p>
                <button type="button" onClick={() => focus(d.id)}>
                  View Existing Person
                </button>
              </div>
            ))}
            <button type="button" disabled={busy} onClick={() => submit(true)}>
              Continue Anyway
            </button>
          </div>
        )}
        <div className="form-footer">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy
              ? "Saving…"
              : edit
                ? "Save changes"
                : mode === "existing"
                  ? "Connect member"
                  : "Add family member"}
            <Check size={16} />
          </button>
        </div>
      </form>
      {newParent && (
        <PersonForm
          relation="spouse"
          person={person}
          close={() => setNewParent(false)}
          focus={focus}
          saved={async (result) => {
            try {
              const updated = await api("/persons/" + person.id);
              setFamilies(updated.families);
              setOtherParent(result.id === person.id ? "" : result.id);
              setNewParent(false);
            } catch (e) {
              setError(e.message);
              setNewParent(false);
            }
          }}
        />
      )}
    </Modal>
  );
}
function DeletePerson({ person, close, done }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Delete this person?" close={busy ? () => {} : close}>
      <div className="delete-summary">
        <Trash2 size={25} />
        <strong>{name(person)}</strong>
      </div>
      <p className="form-intro">
        This permanently removes this person and their family connections. Their
        parents, partners, children, and grandchildren will stay in the tree.
        Children will keep any other recorded parent.
      </p>
      <p className="field-help">
        Wrong family only? Cancel and choose “Change parents / family” to move
        this person without losing their details.
      </p>
      <p className="muted">
        This cannot be undone and will update the tree for everyone.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-footer">
        <button autoFocus disabled={busy} onClick={close}>
          Keep person
        </button>
        <button
          className="delete-person"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/persons/" + person.id, { method: "DELETE" });
              done();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Trash2 size={16} />
          {busy ? "Deleting…" : "Delete person"}
        </button>
      </div>
    </Modal>
  );
}
function MovePerson({ person, close, done }) {
  const [parent, setParent] = useState(""),
    [details, setDetails] = useState(null),
    [other, setOther] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setDetails(null);
    setOther("");
    if (!parent) return;
    let active = true;
    api("/persons/" + parent)
      .then((p) => {
        if (active) {
          setDetails(p);
          setOther(
            p.is_clan_head
              ? p.families.find((f) => f.partner)?.partner.id || ""
              : "",
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [parent]);
  return (
    <Modal title="Change parents / family" close={busy ? () => {} : close}>
      <p className="form-intro">
        Choose the correct parent for <strong>{name(person)}</strong>. This
        replaces their current parents. Their own children, partners, and
        personal details stay with them.
      </p>
      <div className="field-help">
        Current parents:{" "}
        {person.parents.map(name).join(" and ") || "None recorded"}
      </div>
      <PersonPicker
        value={parent}
        onChange={(id) => {
          setParent(id);
          setError("");
        }}
        exclude={[person.id]}
      />
      {details &&
        (details.is_clan_head ? (
          <p className="field-help">
            Both clan heads will be recorded as parents: {name(details)} and{" "}
            {name(details.families.find((f) => f.partner)?.partner)}.
          </p>
        ) : (
          <label>
            Other parent
            <select value={other} onChange={(e) => setOther(e.target.value)}>
              <option value="" disabled>
                Choose the other parent
              </option>
              {details.families
                .filter((f) => f.partner && f.partner.id !== person.id)
                .map((f) => (
                  <option key={f.id} value={f.partner.id}>
                    {name(f.partner)}
                  </option>
                ))}
              <option value="single">No other parent / Unknown</option>
            </select>
          </label>
        ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-footer">
        <button disabled={busy} onClick={close}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={busy || !details || !other}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api("/persons/" + person.id + "/parents", {
                method: "PUT",
                body: JSON.stringify({
                  parent_ids: [parent, ...(other !== "single" ? [other] : [])],
                }),
              });
              done();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save correct family"}
        </button>
      </div>
    </Modal>
  );
}
function RemoveLink({ id, close, done }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Remove this parent connection?" close={close}>
      <p>
        The family member stays in your tree. Their ancestry and family grouping
        will be recalculated.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="form-footer">
        <button onClick={close}>Cancel</button>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/relationships/" + id, { method: "DELETE" });
              done();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Remove connection
        </button>
      </div>
    </Modal>
  );
}
createRoot(document.getElementById("root")).render(<App />);

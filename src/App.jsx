import React, { useState, useEffect, useCallback, useRef } from "react";
import { BASE1_CARDS } from "./base1data";

function buildCards() {
  return BASE1_CARDS.map(([number, name, rarity]) => ({
    id: `base1-${number}`,
    name,
    number,
    rarity,
    supertype: "Pokémon/Trainer/Energy",
    images: {
      small: `https://images.pokemontcg.io/base1/${number}.png`,
      large: `https://images.pokemontcg.io/base1/${number}_hires.png`,
    },
  }));
}

const MAX_PACKS_PER_DAY = 4;
const CARDS_PER_PACK = 6;
const RARITY_WEIGHTS = {
  Common: 60,
  Uncommon: 30,
  Rare: 9,
  "Rare Holo": 1,
};

function todayStr() {
  return new Date().toLocaleDateString("en-CA");
}

function weightedPick(pool) {
  const total = pool.reduce((sum, c) => sum + (RARITY_WEIGHTS[c.rarity] || 1), 0);
  let r = Math.random() * total;
  for (const c of pool) {
    r -= RARITY_WEIGHTS[c.rarity] || 1;
    if (r <= 0) return c;
  }
  return pool[pool.length - 1];
}

function rarityRank(rarity) {
  if (rarity === "Rare Holo") return 3;
  if (rarity === "Rare") return 2;
  if (rarity === "Uncommon") return 1;
  return 0;
}

function loadJSON(_key, fallback) {
  return fallback;
}

function saveJSON(_key, _value) {}

export default function PokeSobres() {
  const [cards, setCards] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [collection, setCollection] = useState({});
  const [opensToday, setOpensToday] = useState(0);
  const [view, setView] = useState("home");
  const [revealing, setRevealing] = useState(false);
  const [revealedCards, setRevealedCards] = useState([]);
  const [revealIndex, setRevealIndex] = useState(-1);
  const [packShaking, setPackShaking] = useState(false);
  const audioCtxRef = useRef(null);

  useEffect(() => {
    setCards(buildCards());
    setLoadState("ready");
  }, []);

  useEffect(() => {}, [collection]);

  useEffect(() => {}, [opensToday]);

  const playTone = useCallback((freq, dur, type = "sine", vol = 0.05) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch {}
  }, []);

  const packsLeft = MAX_PACKS_PER_DAY - opensToday;
  const canOpen = packsLeft > 0 && loadState === "ready" && !revealing;

  const openPack = useCallback(() => {
    if (!canOpen) return;
    setPackShaking(true);
    playTone(220, 0.15, "triangle", 0.04);
    setTimeout(() => {
      const commons = cards.filter((c) => c.rarity === "Common");
      const others = cards.filter((c) => c.rarity !== "Common");
      const pulled = [];
      for (let i = 0; i < CARDS_PER_PACK - 1; i++) {
        pulled.push(weightedPick(commons.length ? commons : cards));
      }
      pulled.push(weightedPick(others.length ? others : cards));
      pulled.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity));

      setCollection((prev) => {
        const next = { ...prev };
        for (const c of pulled) {
          next[c.id] = (next[c.id] || 0) + 1;
        }
        return next;
      });
      setOpensToday((n) => n + 1);
      setRevealedCards(pulled);
      setRevealIndex(-1);
      setPackShaking(false);
      setRevealing(true);
      playTone(440, 0.2, "sine", 0.05);
    }, 700);
  }, [canOpen, cards, playTone]);

  const revealNext = useCallback(() => {
    setRevealIndex((i) => {
      const next = i + 1;
      if (next < revealedCards.length) {
        const card = revealedCards[next];
        if (card.rarity === "Rare Holo") {
          playTone(660, 0.35, "sine", 0.06);
          playTone(880, 0.4, "sine", 0.04);
        } else if (card.rarity === "Rare") {
          playTone(550, 0.25, "sine", 0.05);
        } else {
          playTone(330, 0.12, "triangle", 0.035);
        }
      }
      return next;
    });
  }, [revealedCards, playTone]);

  const closeReveal = useCallback(() => {
    setRevealing(false);
    setRevealedCards([]);
    setRevealIndex(-1);
  }, []);

  const totalUnique = cards.length;
  const ownedUnique = Object.keys(collection).length;
  const completion = totalUnique ? Math.round((ownedUnique / totalUnique) * 100) : 0;

  const styles = {
    page: {
      minHeight: "100vh",
      background: "linear-gradient(180deg, #1a1530 0%, #241b3d 100%)",
      color: "#f4f1ea",
      fontFamily: "'Trebuchet MS', 'Segoe UI', sans-serif",
      paddingBottom: "60px",
    },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "20px 28px",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      flexWrap: "wrap",
      gap: "12px",
    },
    logo: {
      fontSize: "22px",
      fontWeight: 700,
      letterSpacing: "0.5px",
      color: "#ffd95e",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: "8px",
    },
    nav: {
      display: "flex",
      gap: "8px",
    },
    navBtn: (active) => ({
      background: active ? "#ffd95e" : "transparent",
      color: active ? "#241b3d" : "#f4f1ea",
      border: active ? "none" : "1px solid rgba(255,255,255,0.2)",
      borderRadius: "999px",
      padding: "8px 18px",
      fontSize: "14px",
      fontWeight: 600,
      cursor: "pointer",
    }),
    main: {
      maxWidth: "880px",
      margin: "0 auto",
      padding: "32px 24px",
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.logo} onClick={() => setView("home")}>
          <span style={{ fontSize: "26px" }}>{String.fromCodePoint(0x1f0cf)}</span>
          PokéSobres
        </div>
        <div style={styles.nav}>
          <button style={styles.navBtn(view === "home")} onClick={() => setView("home")}>
            Abrir sobres
          </button>
          <button style={styles.navBtn(view === "collection")} onClick={() => setView("collection")}>
            Mi colección
          </button>
        </div>
      </div>

      <div style={styles.main}>
        {loadState === "loading" && <LoadingScreen />}
        {loadState === "error" && <ErrorScreen />}
        {loadState === "ready" && view === "home" && (
          <HomeView
            packsLeft={packsLeft}
            canOpen={canOpen}
            openPack={openPack}
            packShaking={packShaking}
            completion={completion}
            ownedUnique={ownedUnique}
            totalUnique={totalUnique}
          />
        )}
        {loadState === "ready" && view === "collection" && (
          <CollectionView cards={cards} collection={collection} ownedUnique={ownedUnique} totalUnique={totalUnique} />
        )}
      </div>

      {revealing && (
        <RevealOverlay
          cards={revealedCards}
          revealIndex={revealIndex}
          onNext={revealNext}
          onClose={closeReveal}
        />
      )}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ textAlign: "center", padding: "80px 20px", color: "#c9c3e0" }}>
      <div style={{ fontSize: "40px", marginBottom: "16px" }}>{String.fromCodePoint(0x1f3b4)}</div>
      <p>Cargando cartas del Base Set...</p>
    </div>
  );
}

function ErrorScreen() {
  return (
    <div style={{ textAlign: "center", padding: "80px 20px", color: "#f0a0a0" }}>
      <p style={{ fontSize: "18px", marginBottom: "8px" }}>No se pudo conectar con la API de cartas.</p>
      <p style={{ fontSize: "14px", color: "#c9c3e0" }}>
        Probá recargar la página. Si seguís viendo este error, puede ser un problema temporal de pokemontcg.io.
      </p>
    </div>
  );
}

function HomeView({ packsLeft, canOpen, openPack, packShaking, completion, ownedUnique, totalUnique }) {
  return (
    <div style={{ textAlign: "center" }}>
      <h1 style={{ fontSize: "26px", fontWeight: 700, marginBottom: "4px" }}>Sobre Base Set</h1>
      <p style={{ color: "#c9c3e0", marginBottom: "28px" }}>
        {packsLeft > 0
          ? `Te quedan ${packsLeft} sobre${packsLeft === 1 ? "" : "s"} hoy`
          : "Ya abriste todos tus sobres de hoy. Volvé mañana."}
      </p>

      <div
        onClick={openPack}
        style={{
          width: "200px",
          height: "280px",
          margin: "0 auto 28px",
          borderRadius: "16px",
          background: "linear-gradient(145deg, #e8424a 0%, #b21f2d 55%, #7a121d 100%)",
          border: "3px solid #ffd95e",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          cursor: canOpen ? "pointer" : "not-allowed",
          opacity: canOpen ? 1 : 0.45,
          transform: packShaking ? "rotate(-2deg) scale(1.02)" : "none",
          transition: "transform 0.12s ease",
          boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ fontSize: "44px", marginBottom: "10px" }}>{String.fromCodePoint(0x1f525)}</div>
        <div style={{ fontWeight: 700, fontSize: "18px", color: "#ffe9a8", letterSpacing: "1px" }}>BASE SET</div>
        <div style={{ fontSize: "12px", color: "#ffd0d0", marginTop: "6px" }}>6 cartas</div>
      </div>

      <button
        onClick={openPack}
        disabled={!canOpen}
        style={{
          background: canOpen ? "#ffd95e" : "rgba(255,255,255,0.1)",
          color: canOpen ? "#241b3d" : "#888",
          border: "none",
          borderRadius: "999px",
          padding: "14px 36px",
          fontSize: "16px",
          fontWeight: 700,
          cursor: canOpen ? "pointer" : "not-allowed",
        }}
      >
        {canOpen ? "Abrir sobre" : packsLeft <= 0 ? "Sin sobres hoy" : "Cargando..."}
      </button>

      <div
        style={{
          marginTop: "40px",
          display: "inline-flex",
          gap: "24px",
          background: "rgba(255,255,255,0.05)",
          borderRadius: "12px",
          padding: "16px 28px",
        }}
      >
        <Stat label="Colección" value={`${ownedUnique} / ${totalUnique}`} />
        <Stat label="Completado" value={`${completion}%`} />
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: "20px", fontWeight: 700, color: "#ffd95e" }}>{value}</div>
      <div style={{ fontSize: "12px", color: "#c9c3e0" }}>{label}</div>
    </div>
  );
}

function rarityColor(rarity) {
  if (rarity === "Rare Holo") return "#ffd95e";
  if (rarity === "Rare") return "#9fd6ff";
  if (rarity === "Uncommon") return "#a8e6a1";
  return "#d8d4e8";
}

function CollectionView({ cards, collection, ownedUnique, totalUnique }) {
  const completion = totalUnique ? Math.round((ownedUnique / totalUnique) * 100) : 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "20px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Mi colección</h2>
        <span style={{ color: "#c9c3e0", fontSize: "14px" }}>
          {ownedUnique} / {totalUnique} cartas ({completion}%)
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
          gap: "14px",
        }}
      >
        {cards.map((card) => {
          const owned = collection[card.id] || 0;
          return (
            <div
              key={card.id}
              style={{
                background: "rgba(255,255,255,0.04)",
                borderRadius: "10px",
                padding: "8px",
                textAlign: "center",
                opacity: owned ? 1 : 0.28,
                border: owned ? `1px solid ${rarityColor(card.rarity)}55` : "1px solid transparent",
              }}
            >
              <img
                src={card.images.small}
                alt={card.name}
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src =
                    "data:image/svg+xml;utf8," +
                    encodeURIComponent(
                      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#352a55"/><text x="50" y="74" font-size="11" fill="#c9c3e0" text-anchor="middle">sin imagen</text></svg>'
                    );
                }}
                style={{
                  width: "100%",
                  borderRadius: "6px",
                  filter: owned ? "none" : "grayscale(1)",
                  marginBottom: "6px",
                }}
              />
              <div style={{ fontSize: "11px", fontWeight: 600, lineHeight: 1.2 }}>{card.name}</div>
              {owned > 1 && (
                <div style={{ fontSize: "11px", color: "#ffd95e", fontWeight: 700, marginTop: "2px" }}>
                  ×{owned}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RevealOverlay({ cards, revealIndex, onNext, onClose }) {
  const allRevealed = revealIndex >= cards.length - 1;
  const current = revealIndex >= 0 ? cards[revealIndex] : null;

  return (
    <div
      onClick={revealIndex < cards.length - 1 ? onNext : undefined}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,6,20,0.92)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: revealIndex < cards.length - 1 ? "pointer" : "default",
        zIndex: 1000,
        padding: "20px",
      }}
    >
      {revealIndex === -1 ? (
        <div style={{ textAlign: "center", color: "#f4f1ea" }}>
          <div style={{ fontSize: "20px", marginBottom: "20px" }}>Tocá para revelar tus cartas</div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNext();
            }}
            style={{
              background: "#ffd95e",
              color: "#241b3d",
              border: "none",
              borderRadius: "999px",
              padding: "12px 32px",
              fontWeight: 700,
              fontSize: "16px",
              cursor: "pointer",
            }}
          >
            Empezar
          </button>
        </div>
      ) : (
        <>
          <div
            key={current.id + revealIndex}
            style={{
              width: "240px",
              animation: "none",
              textAlign: "center",
            }}
          >
            <img
              src={current.images.large || current.images.small}
              alt={current.name}
              onError={(e) => {
                if (e.target.src !== current.images.small) {
                  e.target.src = current.images.small;
                } else {
                  e.target.onerror = null;
                  e.target.src =
                    "data:image/svg+xml;utf8," +
                    encodeURIComponent(
                      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="335"><rect width="240" height="335" fill="#352a55"/><text x="120" y="170" font-size="14" fill="#c9c3e0" text-anchor="middle">sin imagen</text></svg>'
                    );
                }
              }}
              style={{
                width: "100%",
                borderRadius: "14px",
                boxShadow:
                  current.rarity === "Rare Holo"
                    ? "0 0 50px 10px rgba(255,217,94,0.55)"
                    : current.rarity === "Rare"
                    ? "0 0 30px 6px rgba(159,214,255,0.4)"
                    : "0 8px 24px rgba(0,0,0,0.5)",
              }}
            />
            <div style={{ marginTop: "14px", color: "#f4f1ea", fontWeight: 700, fontSize: "17px" }}>
              {current.name}
            </div>
            <div style={{ marginTop: "2px", fontSize: "13px", fontWeight: 600, color: rarityColor(current.rarity) }}>
              {current.rarity}
            </div>
          </div>

          <div style={{ marginTop: "28px", display: "flex", gap: "6px" }}>
            {cards.map((_, i) => (
              <div
                key={i}
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: i <= revealIndex ? "#ffd95e" : "rgba(255,255,255,0.25)",
                }}
              />
            ))}
          </div>

          <div style={{ marginTop: "18px", fontSize: "13px", color: "#c9c3e0" }}>
            {allRevealed ? "Listo, ya tenés todas tus cartas." : "Tocá la pantalla para ver la siguiente carta"}
          </div>

          {allRevealed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              style={{
                marginTop: "20px",
                background: "#ffd95e",
                color: "#241b3d",
                border: "none",
                borderRadius: "999px",
                padding: "12px 32px",
                fontWeight: 700,
                fontSize: "16px",
                cursor: "pointer",
              }}
            >
              Volver
            </button>
          )}
        </>
      )}
    </div>
  );
}
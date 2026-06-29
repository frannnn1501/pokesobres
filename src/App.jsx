import React, { useState, useEffect, useCallback, useRef } from "react";
import { BASE1_CARDS } from "./base1data";
import { auth, db, googleProvider } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, runTransaction } from "firebase/firestore";

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

const MAX_PACKS_PER_DAY = 3;
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

function emptyUserDoc() {
  return {
    displayName: "",
    lastOpenDate: todayStr(),
    opensToday: 0,
    collection: {},
  };
}

function particleCountFor(rarity) {
  if (rarity === "Rare Holo") return 28;
  if (rarity === "Rare") return 16;
  return 0;
}

function ParticleBurst({ seed, count, color }) {
  const particles = React.useMemo(() => {
    const list = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const dist = 60 + Math.random() * 90;
      list.push({
        id: `${seed}-${i}`,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        size: 4 + Math.random() * 5,
        delay: Math.random() * 80,
      });
    }
    return list;
  }, [seed, count]);

  if (count === 0) return null;

  return (
    <>
      <style>{`
        @keyframes particleFly-${seed} { to { opacity: 0; } }
      `}</style>
      {particles.map((p) => (
        <span
          key={p.id}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: `${p.size}px`,
            height: `${p.size}px`,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 6px 1px ${color}`,
            transform: `translate(-50%, -50%) translate(${p.dx}px, ${p.dy}px)`,
            opacity: 0,
            animation: `particleFly-${seed} 0.05s ${p.delay}ms forwards`,
            transition: `transform 0.7s cubic-bezier(0.16, 0.8, 0.3, 1) ${p.delay}ms, opacity 0.7s ease ${p.delay}ms`,
            pointerEvents: "none",
          }}
          ref={(el) => {
            if (el) {
              requestAnimationFrame(() => {
                el.style.opacity = "1";
                el.style.transform = "translate(-50%, -50%) translate(0, 0)";
                requestAnimationFrame(() => {
                  el.style.transform = `translate(-50%, -50%) translate(${p.dx}px, ${p.dy}px)`;
                  el.style.opacity = "0";
                });
              });
            }
          }}
        />
      ))}
    </>
  );
}

function FlashOverlay({ active, color = "#fff" }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: color,
        opacity: active ? 0.85 : 0,
        transition: active ? "opacity 0.08s ease" : "opacity 0.3s ease",
        pointerEvents: "none",
        borderRadius: "inherit",
      }}
    />
  );
}

export default function PokeSobres() {
  const [cards, setCards] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState("");
  const [profile, setProfile] = useState(null);
  const [collection, setCollection] = useState({});
  const [opensToday, setOpensToday] = useState(0);
  const [view, setView] = useState("home");
  const [revealing, setRevealing] = useState(false);
  const [revealedCards, setRevealedCards] = useState([]);
  const [revealIndex, setRevealIndex] = useState(-1);
  const [packShaking, setPackShaking] = useState(false);
  const [packFlash, setPackFlash] = useState(false);
  const [opening, setOpening] = useState(false);
  const audioCtxRef = useRef(null);

  useEffect(() => {
    setCards(buildCards());
  }, []);

  // Escuchar el estado de login
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthChecked(true);
      if (firebaseUser) {
        await loadOrCreateProfile(firebaseUser);
      } else {
        setProfile(null);
        setCollection({});
        setOpensToday(0);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (authChecked) {
      setLoadState("ready");
    }
  }, [authChecked]);

  const loadOrCreateProfile = useCallback(async (firebaseUser) => {
    const ref = doc(db, "users", firebaseUser.uid);
    try {
      const snap = await getDoc(ref);
      let data;
      if (snap.exists()) {
        data = snap.data();
        // Si cambió el día desde la última visita, no hace falta tocar nada acá:
        // el contador real se resetea en la transacción de openPack.
        if (data.lastOpenDate !== todayStr()) {
          setOpensToday(0);
        } else {
          setOpensToday(data.opensToday || 0);
        }
      } else {
        data = { ...emptyUserDoc(), displayName: firebaseUser.displayName || "" };
        await setDoc(ref, data);
        setOpensToday(0);
      }
      setProfile(data);
      setCollection(data.collection || {});
    } catch (err) {
      setAuthError("No se pudo cargar tu perfil. Probá recargar la página.");
    }
  }, []);

  const loginWithGoogle = useCallback(async () => {
    setAuthError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError("No se pudo iniciar sesión. Probá de nuevo.");
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    setView("home");
  }, []);

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
  const canOpen = user && packsLeft > 0 && loadState === "ready" && !revealing && !opening;

  const openPack = useCallback(async () => {
    if (!canOpen || !user) return;
    setOpening(true);
    setPackShaking(true);
    playTone(220, 0.15, "triangle", 0.04);

    // Sorteo de cartas en el cliente
    const commons = cards.filter((c) => c.rarity === "Common");
    const others = cards.filter((c) => c.rarity !== "Common");
    const pulled = [];
    for (let i = 0; i < CARDS_PER_PACK - 1; i++) {
      pulled.push(weightedPick(commons.length ? commons : cards));
    }
    pulled.push(weightedPick(others.length ? others : cards));
    pulled.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity));

    const ref = doc(db, "users", user.uid);
    try {
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists() ? snap.data() : emptyUserDoc();
        const today = todayStr();
        const isNewDay = data.lastOpenDate !== today;
        const currentOpens = isNewDay ? 0 : data.opensToday || 0;

        if (currentOpens >= MAX_PACKS_PER_DAY) {
          throw new Error("LIMIT_REACHED");
        }

        const newCollection = { ...(data.collection || {}) };
        for (const c of pulled) {
          newCollection[c.id] = (newCollection[c.id] || 0) + 1;
        }

        const newData = {
          ...data,
          displayName: user.displayName || data.displayName || "",
          lastOpenDate: today,
          opensToday: currentOpens + 1,
          collection: newCollection,
        };
        tx.set(ref, newData);
        return newData;
      });

      setCollection(result.collection);
      setOpensToday(result.opensToday);
      setProfile(result);
      setTimeout(() => {
        setPackFlash(true);
        playTone(440, 0.2, "sine", 0.05);
        setTimeout(() => {
          setRevealedCards(pulled);
          setRevealIndex(-1);
          setPackShaking(false);
          setPackFlash(false);
          setRevealing(true);
          setOpening(false);
        }, 130);
      }, 500);
    } catch (err) {
      setPackShaking(false);
      setOpening(false);
      if (err.message === "LIMIT_REACHED") {
        setOpensToday(MAX_PACKS_PER_DAY);
      } else {
        setAuthError("No se pudo abrir el sobre. Probá de nuevo.");
      }
    }
  }, [canOpen, cards, playTone, user]);

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
        {user && (
          <div style={styles.nav}>
            <button style={styles.navBtn(view === "home")} onClick={() => setView("home")}>
              Abrir sobres
            </button>
            <button style={styles.navBtn(view === "collection")} onClick={() => setView("collection")}>
              Mi colección
            </button>
            <button
              onClick={logout}
              style={{
                background: "transparent",
                color: "#c9c3e0",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "999px",
                padding: "8px 16px",
                fontSize: "13px",
                cursor: "pointer",
              }}
              title={user.displayName || user.email}
            >
              Salir
            </button>
          </div>
        )}
      </div>

      <div style={styles.main}>
        {authError && (
          <div style={{ textAlign: "center", color: "#f0a0a0", marginBottom: "16px", fontSize: "14px" }}>
            {authError}
          </div>
        )}
        {!authChecked && <LoadingScreen />}
        {authChecked && !user && <LoginScreen onLogin={loginWithGoogle} />}
        {authChecked && user && loadState === "ready" && view === "home" && (
          <HomeView
            packsLeft={packsLeft}
            canOpen={canOpen}
            opening={opening}
            openPack={openPack}
            packShaking={packShaking}
            packFlash={packFlash}
            completion={completion}
            ownedUnique={ownedUnique}
            totalUnique={totalUnique}
            displayName={user.displayName}
          />
        )}
        {authChecked && user && loadState === "ready" && view === "collection" && (
          <CollectionView cards={cards} collection={collection} ownedUnique={ownedUnique} totalUnique={totalUnique} />
        )}
      </div>

      {revealing && (
        <RevealOverlay
          cards={revealedCards}
          revealIndex={revealIndex}
          onNext={revealNext}
          onClose={closeReveal}
          playTone={playTone}
        />
      )}
    </div>
  );
}

function LoginScreen({ onLogin }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <div style={{ fontSize: "50px", marginBottom: "16px" }}>{String.fromCodePoint(0x1f0cf)}</div>
      <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "8px" }}>Bienvenido a PokéSobres</h1>
      <p style={{ color: "#c9c3e0", marginBottom: "28px", fontSize: "14px" }}>
        Iniciá sesión para guardar tu colección y abrir tus sobres todos los días.
      </p>
      <button
        onClick={onLogin}
        style={{
          background: "#fff",
          color: "#1f1f1f",
          border: "none",
          borderRadius: "999px",
          padding: "12px 28px",
          fontSize: "15px",
          fontWeight: 600,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.85 2.09-1.81 2.73v2.27h2.92c1.71-1.57 2.69-3.89 2.69-6.64z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.27c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33C2.44 15.98 5.48 18 9 18z"
          />
          <path
            fill="#FBBC05"
            d="M3.97 10.71c-.18-.54-.28-1.11-.28-1.71s.1-1.17.28-1.71V4.96H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.33z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
          />
        </svg>
        Iniciar sesión con Google
      </button>
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

function HomeView({ packsLeft, canOpen, opening, openPack, packShaking, packFlash, completion, ownedUnique, totalUnique, displayName }) {
  return (
    <div style={{ textAlign: "center" }}>
      {displayName && (
        <p style={{ color: "#9d96c0", fontSize: "13px", marginBottom: "4px" }}>Hola, {displayName.split(" ")[0]}</p>
      )}
      <h1 style={{ fontSize: "26px", fontWeight: 700, marginBottom: "4px" }}>Sobre Base Set</h1>
      <p style={{ color: "#c9c3e0", marginBottom: "28px" }}>
        {packsLeft > 0
          ? `Te quedan ${packsLeft} sobre${packsLeft === 1 ? "" : "s"} hoy`
          : "Ya abriste todos tus sobres de hoy. Volvé mañana."}
      </p>

      <div
        onClick={openPack}
        style={{
          position: "relative",
          width: "200px",
          height: "280px",
          margin: "0 auto 28px",
          borderRadius: "16px",
          overflow: "hidden",
          background: "linear-gradient(145deg, #e8424a 0%, #b21f2d 55%, #7a121d 100%)",
          border: "3px solid #ffd95e",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          cursor: canOpen ? "pointer" : "not-allowed",
          opacity: canOpen ? 1 : 0.45,
          transform: packShaking ? "rotate(-3deg) scale(1.06)" : "none",
          transition: packShaking ? "transform 0.09s ease-in-out" : "transform 0.2s ease",
          boxShadow: packShaking
            ? "0 0 40px 6px rgba(255,217,94,0.5), 0 12px 30px rgba(0,0,0,0.4)"
            : "0 12px 30px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ fontSize: "44px", marginBottom: "10px" }}>{String.fromCodePoint(0x1f525)}</div>
        <div style={{ fontWeight: 700, fontSize: "18px", color: "#ffe9a8", letterSpacing: "1px" }}>BASE SET</div>
        <div style={{ fontSize: "12px", color: "#ffd0d0", marginTop: "6px" }}>6 cartas</div>
        <FlashOverlay active={packFlash} />
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
        {opening ? "Abriendo..." : canOpen ? "Abrir sobre" : packsLeft <= 0 ? "Sin sobres hoy" : "Cargando..."}
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

function CardReveal({ card, revealKey, playTone }) {
  const [stage, setStage] = useState("flash"); // flash -> popping -> settled
  const isBig = card.rarity === "Rare Holo" || card.rarity === "Rare";
  const particleColor = card.rarity === "Rare Holo" ? "#ffd95e" : "#9fd6ff";

  useEffect(() => {
    setStage("flash");
    const t1 = setTimeout(() => setStage("popping"), isBig ? 130 : 30);
    const t2 = setTimeout(() => setStage("settled"), isBig ? 600 : 350);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [revealKey, isBig]);

  return (
    <div
      style={{
        position: "relative",
        width: "240px",
        textAlign: "center",
      }}
    >
      <FlashOverlay active={stage === "flash" && isBig} color={particleColor} />
      {stage !== "flash" && <ParticleBurst seed={revealKey} count={particleCountFor(card.rarity)} color={particleColor} />}

      <div
        style={{
          transform:
            stage === "flash"
              ? "scale(0.25)"
              : stage === "popping"
              ? isBig
                ? "scale(1.15)"
                : "scale(1.03)"
              : "scale(1)",
          opacity: stage === "flash" ? 0 : 1,
          transition:
            stage === "flash"
              ? "none"
              : stage === "popping"
              ? `transform ${isBig ? 0.4 : 0.22}s cubic-bezier(0.17, 0.89, 0.32, 1.49), opacity 0.2s ease`
              : "transform 0.25s ease",
        }}
      >
        <img
          src={card.images.large || card.images.small}
          alt={card.name}
          onError={(e) => {
            if (e.target.src !== card.images.small) {
              e.target.src = card.images.small;
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
              card.rarity === "Rare Holo"
                ? "0 0 50px 10px rgba(255,217,94,0.55)"
                : card.rarity === "Rare"
                ? "0 0 30px 6px rgba(159,214,255,0.4)"
                : "0 8px 24px rgba(0,0,0,0.5)",
          }}
        />
        <div style={{ marginTop: "14px", color: "#f4f1ea", fontWeight: 700, fontSize: "17px" }}>{card.name}</div>
        <div style={{ marginTop: "2px", fontSize: "13px", fontWeight: 600, color: rarityColor(card.rarity) }}>
          {card.rarity}
        </div>
      </div>
    </div>
  );
}

function RevealOverlay({ cards, revealIndex, onNext, onClose, playTone }) {
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
        overflow: "hidden",
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
          <CardReveal card={current} revealKey={`${current.id}-${revealIndex}`} playTone={playTone} />

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

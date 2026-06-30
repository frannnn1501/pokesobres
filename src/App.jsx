import React, { useState, useEffect, useCallback, useRef } from "react";
import { BASE1_CARDS } from "./base1data";
import { auth, db, googleProvider } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, runTransaction, collection, query, where, getDocs, addDoc, onSnapshot } from "firebase/firestore";

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
const EXTRA_PACK_COST = 75;
const SELL_PRICE = {
  Common: 2,
  Uncommon: 5,
  Rare: 20,
  "Rare Holo": 60,
};
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
    username: "",
    lastOpenDate: todayStr(),
    opensToday: 0,
    collection: {},
    coins: 0,
    friends: {},
  };
}

function isValidUsername(name) {
  return /^[a-z0-9_]{3,20}$/.test(name);
}

function drawPack(cards) {
  const commons = cards.filter((c) => c.rarity === "Common");
  const others = cards.filter((c) => c.rarity !== "Common");
  const pulled = [];
  for (let i = 0; i < CARDS_PER_PACK - 1; i++) {
    pulled.push(weightedPick(commons.length ? commons : cards));
  }
  pulled.push(weightedPick(others.length ? others : cards));
  pulled.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity));
  return pulled;
}

function sellPriceFor(rarity) {
  return SELL_PRICE[rarity] || 1;
}

function particleCountFor(rarity) {
  if (rarity === "Rare Holo") return 32;
  if (rarity === "Rare") return 20;
  if (rarity === "Uncommon") return 10;
  return 5;
}

function particleColorFor(rarity) {
  if (rarity === "Rare Holo") return "#ffd95e";
  if (rarity === "Rare") return "#9fd6ff";
  if (rarity === "Uncommon") return "#a8e6a1";
  return "#d8d4e8";
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

function FlashOverlay({ active, color = "#fff", intensity = 0.85 }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: color,
        opacity: active ? intensity : 0,
        transition: active ? "opacity 0.08s ease" : "opacity 0.3s ease",
        pointerEvents: "none",
        borderRadius: "inherit",
      }}
    />
  );
}

const PACK_THEMES = [
  {
    id: "fire",
    label: "Llama",
    gradient: "linear-gradient(160deg, #ff8a3d 0%, #e8424a 45%, #7a121d 100%)",
    glow: "rgba(255,138,61,0.55)",
    accent: "#ffd95e",
  },
  {
    id: "water",
    label: "Marea",
    gradient: "linear-gradient(160deg, #5fc8e8 0%, #2f7fc9 45%, #123a6e 100%)",
    glow: "rgba(95,200,232,0.55)",
    accent: "#cdeeff",
  },
  {
    id: "leaf",
    label: "Follaje",
    gradient: "linear-gradient(160deg, #8fe06a 0%, #3f9e4f 45%, #1c4d24 100%)",
    glow: "rgba(143,224,106,0.5)",
    accent: "#e8ffd0",
  },
];

function pickRandomTheme(excludeId) {
  const pool = excludeId ? PACK_THEMES.filter((t) => t.id !== excludeId) : PACK_THEMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

function PackArt({ theme, flash }) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: "16px",
        overflow: "hidden",
        background: theme.gradient,
      }}
    >
      <svg
        viewBox="0 0 200 280"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.5 }}
      >
        <circle cx="100" cy="95" r="70" fill="none" stroke={theme.accent} strokeWidth="2" opacity="0.35" />
        <circle cx="100" cy="95" r="46" fill="none" stroke={theme.accent} strokeWidth="2" opacity="0.5" />
        {theme.id === "fire" && (
          <path
            d="M100 50 C70 90 70 120 100 150 C130 120 130 90 100 50 Z M100 75 C90 95 90 110 100 125 C110 110 110 95 100 75 Z"
            fill={theme.accent}
            opacity="0.85"
          />
        )}
        {theme.id === "water" && (
          <path d="M100 50 C60 95 60 130 100 150 C140 130 140 95 100 50 Z" fill={theme.accent} opacity="0.8" />
        )}
        {theme.id === "leaf" && (
          <g fill={theme.accent} opacity="0.85">
            <path d="M100 55 C75 70 70 105 100 145 C130 105 125 70 100 55 Z" />
            <path d="M100 80 L100 145" stroke="#1c4d24" strokeWidth="3" opacity="0.4" fill="none" />
          </g>
        )}
        {Array.from({ length: 6 }).map((_, i) => (
          <circle key={i} cx={30 + i * 30} cy={220 + (i % 2) * 20} r="3" fill={theme.accent} opacity="0.4" />
        ))}
      </svg>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "19px", letterSpacing: "2px", textShadow: "0 2px 8px rgba(0,0,0,0.4)" }}>
          BASE SET
        </div>
        <div style={{ fontSize: "11px", opacity: 0.85, marginTop: "6px", letterSpacing: "1px" }}>
          {theme.label.toUpperCase()}
        </div>
        <div style={{ fontSize: "11px", opacity: 0.7, marginTop: "10px" }}>6 cartas</div>
      </div>

      <FlashOverlay active={flash} color={theme.accent} />
    </div>
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
  const [coins, setCoins] = useState(0);
  const [username, setUsername] = useState("");
  const [needsUsername, setNeedsUsername] = useState(false);
  const [usernameError, setUsernameError] = useState("");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [friends, setFriends] = useState({});
  const [friendRequests, setFriendRequests] = useState([]);
  const [friendProfiles, setFriendProfiles] = useState({});
  const [viewingFriendUid, setViewingFriendUid] = useState(null);
  const [view, setView] = useState("home");
  const [revealing, setRevealing] = useState(false);
  const [revealedCards, setRevealedCards] = useState([]);
  const [revealIndex, setRevealIndex] = useState(-1);
  const [packFlash, setPackFlash] = useState(false);
  const [opening, setOpening] = useState(false);
  const [packTheme, setPackTheme] = useState(() => pickRandomTheme());
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
        setCoins(0);
        setUsername("");
        setFriends({});
        setNeedsUsername(false);
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
      setCoins(data.coins || 0);
      setUsername(data.username || "");
      setFriends(data.friends || {});
      setNeedsUsername(!data.username);
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

  const claimUsername = useCallback(
    async (rawName) => {
      if (!user) return;
      const name = rawName.trim().toLowerCase();
      setUsernameError("");

      if (!isValidUsername(name)) {
        setUsernameError("Usá entre 3 y 20 letras minúsculas, números o guion bajo.");
        return;
      }

      setUsernameSaving(true);
      const usernameRef = doc(db, "usernames", name);
      const userRef = doc(db, "users", user.uid);
      try {
        await runTransaction(db, async (tx) => {
          const usernameSnap = await tx.get(usernameRef);
          if (usernameSnap.exists()) {
            throw new Error("TAKEN");
          }
          const userSnap = await tx.get(userRef);
          const data = userSnap.exists() ? userSnap.data() : emptyUserDoc();
          tx.set(usernameRef, { uid: user.uid });
          tx.set(userRef, { ...data, username: name });
        });
        setUsername(name);
        setNeedsUsername(false);
        setProfile((p) => ({ ...(p || {}), username: name }));
      } catch (err) {
        if (err.message === "TAKEN") {
          setUsernameError("Ese nombre de usuario ya está en uso. Probá otro.");
        } else {
          setUsernameError("No se pudo guardar. Probá de nuevo.");
        }
      } finally {
        setUsernameSaving(false);
      }
    },
    [user]
  );

  const sendFriendRequest = useCallback(
    async (targetUsername) => {
      if (!user || !username) return { ok: false, message: "Necesitás tener tu propio username primero." };
      const name = targetUsername.trim().toLowerCase();
      if (!name) return { ok: false, message: "Escribí un nombre de usuario." };
      if (name === username) return { ok: false, message: "No podés agregarte a vos mismo." };

      try {
        const usernameSnap = await getDoc(doc(db, "usernames", name));
        if (!usernameSnap.exists()) {
          return { ok: false, message: "No existe ningún usuario con ese nombre." };
        }
        const targetUid = usernameSnap.data().uid;
        if (friends[targetUid]) {
          return { ok: false, message: "Ya son amigos." };
        }

        const existingQuery = query(
          collection(db, "friendRequests"),
          where("fromUid", "==", user.uid),
          where("toUid", "==", targetUid),
          where("status", "==", "pending")
        );
        const existing = await getDocs(existingQuery);
        if (!existing.empty) {
          return { ok: false, message: "Ya le mandaste una solicitud, esperá a que responda." };
        }

        await addDoc(collection(db, "friendRequests"), {
          fromUid: user.uid,
          fromUsername: username,
          toUid: targetUid,
          toUsername: name,
          status: "pending",
          createdAt: todayStr(),
        });
        return { ok: true, message: `Solicitud enviada a ${name}.` };
      } catch (err) {
        return { ok: false, message: "No se pudo enviar la solicitud. Probá de nuevo." };
      }
    },
    [user, username, friends]
  );

  const respondFriendRequest = useCallback(
    async (request, accept) => {
      if (!user) return;
      const reqRef = doc(db, "friendRequests", request.id);
      const myRef = doc(db, "users", user.uid);
      try {
        if (accept) {
          await runTransaction(db, async (tx) => {
            const mySnap = await tx.get(myRef);
            const myData = mySnap.exists() ? mySnap.data() : emptyUserDoc();
            tx.update(myRef, { friends: { ...(myData.friends || {}), [request.fromUid]: true } });
            tx.update(reqRef, { status: "accepted" });
          });
          setFriends((f) => ({ ...f, [request.fromUid]: true }));
        } else {
          await updateDoc(reqRef, { status: "rejected" });
        }
      } catch (err) {
        setAuthError("No se pudo procesar la solicitud. Probá de nuevo.");
      }
    },
    [user]
  );

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

  // Escuchar solicitudes de amistad pendientes dirigidas a mí, en tiempo real
  useEffect(() => {
    if (!user) {
      setFriendRequests([]);
      return;
    }
    const q = query(
      collection(db, "friendRequests"),
      where("toUid", "==", user.uid),
      where("status", "==", "pending")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setFriendRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      () => {}
    );
    return () => unsub();
  }, [user]);

  // Escuchar mis propias solicitudes que ya fueron aceptadas, para completar
  // la amistad de mi lado también (el que las acepta solo actualiza su documento).
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "friendRequests"),
      where("fromUid", "==", user.uid),
      where("status", "==", "accepted")
    );
    const unsub = onSnapshot(
      q,
      async (snap) => {
        for (const docSnap of snap.docs) {
          const req = docSnap.data();
          if (!friends[req.toUid]) {
            try {
              const myRef = doc(db, "users", user.uid);
              const mySnap = await getDoc(myRef);
              const myData = mySnap.exists() ? mySnap.data() : emptyUserDoc();
              if (!myData.friends || !myData.friends[req.toUid]) {
                await updateDoc(myRef, { friends: { ...(myData.friends || {}), [req.toUid]: true } });
                setFriends((f) => ({ ...f, [req.toUid]: true }));
              }
            } catch {}
          }
        }
      },
      () => {}
    );
    return () => unsub();
  }, [user, friends]);

  // Cargar los perfiles públicos básicos de mis amigos (nombre, colección) para la lista
  useEffect(() => {
    const uids = Object.keys(friends || {});
    if (uids.length === 0) {
      setFriendProfiles({});
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        uids.map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, "users", uid));
            return [uid, snap.exists() ? snap.data() : null];
          } catch {
            return [uid, null];
          }
        })
      );
      if (!cancelled) {
        setFriendProfiles(Object.fromEntries(entries));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [friends]);

  const packsLeft = MAX_PACKS_PER_DAY - opensToday;
  const canOpen = user && packsLeft > 0 && loadState === "ready" && !revealing && !opening;

  const openPack = useCallback(async () => {
    if (!canOpen || !user) return;
    setOpening(true);
    setPackFlash(true);
    playTone(440, 0.18, "sine", 0.06);

    // Sorteo de cartas en el cliente
    const pulled = drawPack(cards);

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
        setRevealedCards(pulled);
        setRevealIndex(0);
        setPackFlash(false);
        setRevealing(true);
        setOpening(false);
        setPackTheme((prevTheme) => pickRandomTheme(prevTheme.id));
        const firstCard = pulled[0];
        if (firstCard.rarity === "Rare Holo") {
          playTone(660, 0.35, "sine", 0.06);
          playTone(880, 0.4, "sine", 0.04);
        } else if (firstCard.rarity === "Rare") {
          playTone(550, 0.25, "sine", 0.05);
        } else {
          playTone(330, 0.12, "triangle", 0.035);
        }
      }, 150);
    } catch (err) {
      setPackFlash(false);
      setOpening(false);
      if (err.message === "LIMIT_REACHED") {
        setOpensToday(MAX_PACKS_PER_DAY);
      } else {
        setAuthError("No se pudo abrir el sobre. Probá de nuevo.");
      }
    }
  }, [canOpen, cards, playTone, user]);

  const sellCard = useCallback(
    async (cardId) => {
      if (!user) return;
      const card = cards.find((c) => c.id === cardId);
      if (!card) return;
      const price = sellPriceFor(card.rarity);
      const ref = doc(db, "users", user.uid);
      try {
        const result = await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          const data = snap.exists() ? snap.data() : emptyUserDoc();
          const owned = (data.collection || {})[cardId] || 0;
          if (owned <= 0) {
            throw new Error("NOT_OWNED");
          }
          const newCollection = { ...data.collection };
          if (owned <= 1) {
            delete newCollection[cardId];
          } else {
            newCollection[cardId] = owned - 1;
          }
          const newData = {
            ...data,
            collection: newCollection,
            coins: (data.coins || 0) + price,
          };
          tx.set(ref, newData);
          return newData;
        });
        setCollection(result.collection);
        setCoins(result.coins);
        setProfile(result);
        playTone(523, 0.1, "sine", 0.04);
        playTone(659, 0.12, "sine", 0.04);
      } catch (err) {
        setAuthError("No se pudo vender la carta. Probá de nuevo.");
      }
    },
    [user, cards, playTone]
  );

  const buyExtraPack = useCallback(async () => {
    if (!user || opening || revealing) return;
    if (coins < EXTRA_PACK_COST) return;
    setOpening(true);
    setPackFlash(true);
    playTone(440, 0.18, "sine", 0.06);

    const pulled = drawPack(cards);
    const ref = doc(db, "users", user.uid);
    try {
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists() ? snap.data() : emptyUserDoc();
        const currentCoins = data.coins || 0;
        if (currentCoins < EXTRA_PACK_COST) {
          throw new Error("NOT_ENOUGH_COINS");
        }
        const newCollection = { ...(data.collection || {}) };
        for (const c of pulled) {
          newCollection[c.id] = (newCollection[c.id] || 0) + 1;
        }
        const newData = {
          ...data,
          displayName: user.displayName || data.displayName || "",
          collection: newCollection,
          coins: currentCoins - EXTRA_PACK_COST,
        };
        tx.set(ref, newData);
        return newData;
      });

      setCollection(result.collection);
      setCoins(result.coins);
      setProfile(result);
      setTimeout(() => {
        setRevealedCards(pulled);
        setRevealIndex(0);
        setPackFlash(false);
        setRevealing(true);
        setOpening(false);
        setPackTheme((prevTheme) => pickRandomTheme(prevTheme.id));
        const firstCard = pulled[0];
        if (firstCard.rarity === "Rare Holo") {
          playTone(660, 0.35, "sine", 0.06);
          playTone(880, 0.4, "sine", 0.04);
        } else if (firstCard.rarity === "Rare") {
          playTone(550, 0.25, "sine", 0.05);
        } else {
          playTone(330, 0.12, "triangle", 0.035);
        }
      }, 150);
    } catch (err) {
      setPackFlash(false);
      setOpening(false);
      setAuthError("No se pudo comprar el sobre. Probá de nuevo.");
    }
  }, [user, opening, revealing, coins, cards, playTone]);

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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "rgba(255,217,94,0.12)",
                border: "1px solid rgba(255,217,94,0.35)",
                borderRadius: "999px",
                padding: "8px 14px",
                fontSize: "13px",
                fontWeight: 700,
                color: "#ffd95e",
              }}
              title="Tus monedas"
            >
              <span>{String.fromCodePoint(0x1fa99)}</span>
              {coins}
            </div>
            <button style={styles.navBtn(view === "home")} onClick={() => setView("home")}>
              Abrir sobres
            </button>
            <button style={styles.navBtn(view === "collection")} onClick={() => setView("collection")}>
              Mi colección
            </button>
            <button
              style={{ ...styles.navBtn(view === "friends"), position: "relative" }}
              onClick={() => {
                setView("friends");
                setViewingFriendUid(null);
              }}
            >
              Amigos
              {friendRequests.length > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: "-4px",
                    right: "-4px",
                    background: "#e8424a",
                    color: "#fff",
                    borderRadius: "999px",
                    fontSize: "10px",
                    fontWeight: 700,
                    minWidth: "16px",
                    height: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 3px",
                  }}
                >
                  {friendRequests.length}
                </span>
              )}
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
        {authChecked && user && needsUsername && (
          <UsernameScreen onSubmit={claimUsername} error={usernameError} saving={usernameSaving} />
        )}
        {authChecked && user && !needsUsername && loadState === "ready" && view === "home" && (
          <HomeView
            packsLeft={packsLeft}
            canOpen={canOpen}
            opening={opening}
            openPack={openPack}
            packTheme={packTheme}
            packFlash={packFlash}
            completion={completion}
            ownedUnique={ownedUnique}
            totalUnique={totalUnique}
            displayName={user.displayName}
            coins={coins}
            buyExtraPack={buyExtraPack}
            revealing={revealing}
          />
        )}
        {authChecked && user && !needsUsername && loadState === "ready" && view === "collection" && (
          <CollectionView
            cards={cards}
            collection={collection}
            ownedUnique={ownedUnique}
            totalUnique={totalUnique}
            coins={coins}
            onSell={sellCard}
          />
        )}
        {authChecked && user && !needsUsername && loadState === "ready" && view === "friends" && !viewingFriendUid && (
          <FriendsView
            username={username}
            friends={friends}
            friendProfiles={friendProfiles}
            friendRequests={friendRequests}
            onSendRequest={sendFriendRequest}
            onRespond={respondFriendRequest}
            onViewFriend={setViewingFriendUid}
          />
        )}
        {authChecked && user && !needsUsername && loadState === "ready" && view === "friends" && viewingFriendUid && (
          <FriendCollectionView
            cards={cards}
            friendProfile={friendProfiles[viewingFriendUid]}
            onBack={() => setViewingFriendUid(null)}
          />
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

function UsernameScreen({ onSubmit, error, saving }) {
  const [value, setValue] = useState("");
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", maxWidth: "360px", margin: "0 auto" }}>
      <div style={{ fontSize: "44px", marginBottom: "12px" }}>{String.fromCodePoint(0x1f3ae)}</div>
      <h1 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "8px" }}>Elegí tu nombre de usuario</h1>
      <p style={{ color: "#c9c3e0", fontSize: "13px", marginBottom: "24px" }}>
        Tus amigos te van a poder buscar por este nombre. Solo letras minúsculas, números y guion bajo (3-20
        caracteres).
      </p>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !saving) onSubmit(value);
        }}
        placeholder="ej: fran_tcg"
        style={{
          width: "100%",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: "10px",
          padding: "12px 16px",
          color: "#f4f1ea",
          fontSize: "15px",
          marginBottom: "12px",
          boxSizing: "border-box",
          textAlign: "center",
        }}
      />
      {error && <p style={{ color: "#f0a0a0", fontSize: "13px", marginBottom: "12px" }}>{error}</p>}
      <button
        onClick={() => onSubmit(value)}
        disabled={saving || !value.trim()}
        style={{
          background: saving || !value.trim() ? "rgba(255,255,255,0.1)" : "#ffd95e",
          color: saving || !value.trim() ? "#888" : "#241b3d",
          border: "none",
          borderRadius: "999px",
          padding: "12px 32px",
          fontSize: "15px",
          fontWeight: 700,
          cursor: saving || !value.trim() ? "not-allowed" : "pointer",
          width: "100%",
        }}
      >
        {saving ? "Guardando..." : "Confirmar"}
      </button>
    </div>
  );
}

function FriendsView({ username, friends, friendProfiles, friendRequests, onSendRequest, onRespond, onViewFriend }) {
  const [searchValue, setSearchValue] = useState("");
  const [searchStatus, setSearchStatus] = useState(null);
  const [sending, setSending] = useState(false);
  const friendUids = Object.keys(friends || {});

  const handleSend = async () => {
    if (!searchValue.trim() || sending) return;
    setSending(true);
    setSearchStatus(null);
    const result = await onSendRequest(searchValue);
    setSearchStatus(result);
    setSending(false);
    if (result.ok) setSearchValue("");
  };

  return (
    <div>
      <div style={{ marginBottom: "8px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Amigos</h2>
        <p style={{ color: "#8d87a8", fontSize: "12px", marginTop: "4px" }}>
          Tu nombre de usuario es <strong style={{ color: "#ffd95e" }}>{username}</strong>
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: "8px",
          marginTop: "20px",
          marginBottom: "8px",
        }}
      >
        <input
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          placeholder="Nombre de usuario de tu amigo"
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "10px",
            padding: "10px 14px",
            color: "#f4f1ea",
            fontSize: "14px",
          }}
        />
        <button
          onClick={handleSend}
          disabled={sending}
          style={{
            background: "#ffd95e",
            color: "#241b3d",
            border: "none",
            borderRadius: "10px",
            padding: "10px 20px",
            fontWeight: 700,
            fontSize: "14px",
            cursor: sending ? "not-allowed" : "pointer",
            opacity: sending ? 0.6 : 1,
          }}
        >
          Agregar
        </button>
      </div>
      {searchStatus && (
        <p style={{ fontSize: "13px", color: searchStatus.ok ? "#a8e6a1" : "#f0a0a0", marginBottom: "20px" }}>
          {searchStatus.message}
        </p>
      )}

      {friendRequests.length > 0 && (
        <div style={{ marginTop: "20px", marginBottom: "28px" }}>
          <h3 style={{ fontSize: "14px", color: "#c9c3e0", marginBottom: "10px" }}>Solicitudes pendientes</h3>
          {friendRequests.map((req) => (
            <div
              key={req.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "rgba(255,255,255,0.05)",
                borderRadius: "10px",
                padding: "10px 14px",
                marginBottom: "8px",
              }}
            >
              <span style={{ fontSize: "14px" }}>{req.fromUsername}</span>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  onClick={() => onRespond(req, true)}
                  style={{
                    background: "#a8e6a1",
                    color: "#1c4d24",
                    border: "none",
                    borderRadius: "999px",
                    padding: "6px 14px",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Aceptar
                </button>
                <button
                  onClick={() => onRespond(req, false)}
                  style={{
                    background: "transparent",
                    color: "#c9c3e0",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: "999px",
                    padding: "6px 14px",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  Rechazar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ fontSize: "14px", color: "#c9c3e0", marginBottom: "10px" }}>
        Tus amigos {friendUids.length > 0 && `(${friendUids.length})`}
      </h3>
      {friendUids.length === 0 ? (
        <p style={{ color: "#8d87a8", fontSize: "13px" }}>Todavía no agregaste a nadie.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {friendUids.map((uid) => {
            const fp = friendProfiles[uid];
            const ownedCount = fp ? Object.keys(fp.collection || {}).length : null;
            return (
              <div
                key={uid}
                onClick={() => onViewFriend(uid)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: "10px",
                  padding: "12px 16px",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontWeight: 600 }}>{fp ? fp.username || fp.displayName : "Cargando..."}</span>
                <span style={{ fontSize: "12px", color: "#c9c3e0" }}>
                  {ownedCount !== null ? `${ownedCount} cartas` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FriendCollectionView({ cards, friendProfile, onBack }) {
  if (!friendProfile) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "#c9c3e0" }}>
        <p>Cargando colección...</p>
        <button
          onClick={onBack}
          style={{
            marginTop: "16px",
            background: "transparent",
            color: "#c9c3e0",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "999px",
            padding: "8px 18px",
            cursor: "pointer",
          }}
        >
          Volver
        </button>
      </div>
    );
  }

  const friendCollection = friendProfile.collection || {};
  const ownedUnique = Object.keys(friendCollection).length;
  const totalUnique = cards.length;
  const completion = totalUnique ? Math.round((ownedUnique / totalUnique) * 100) : 0;

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          background: "transparent",
          color: "#c9c3e0",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: "999px",
          padding: "6px 16px",
          fontSize: "13px",
          cursor: "pointer",
          marginBottom: "16px",
        }}
      >
        ← Volver a amigos
      </button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "20px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>
          Colección de {friendProfile.username || friendProfile.displayName}
        </h2>
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
          const owned = friendCollection[card.id] || 0;
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
                <div style={{ fontSize: "11px", color: "#ffd95e", fontWeight: 700, marginTop: "2px" }}>×{owned}</div>
              )}
            </div>
          );
        })}
      </div>
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

function HomeView({
  packsLeft,
  canOpen,
  opening,
  openPack,
  packTheme,
  packFlash,
  completion,
  ownedUnique,
  totalUnique,
  displayName,
  coins,
  buyExtraPack,
  revealing,
}) {
  const canBuyExtra = coins >= EXTRA_PACK_COST && !opening && !revealing;
  return (
    <div style={{ textAlign: "center" }}>
      {displayName && (
        <p style={{ color: "#9d96c0", fontSize: "13px", marginBottom: "4px" }}>Hola, {displayName.split(" ")[0]}</p>
      )}
      <h1 style={{ fontSize: "26px", fontWeight: 700, marginBottom: "4px" }}>Sobre Base Set</h1>
      <p style={{ color: "#c9c3e0", marginBottom: "28px" }}>
        {packsLeft > 0
          ? `Te quedan ${packsLeft} sobre${packsLeft === 1 ? "" : "s"} hoy`
          : "Ya abriste todos tus sobres gratis de hoy."}
      </p>

      <div
        onClick={canOpen ? openPack : undefined}
        style={{
          width: "200px",
          height: "280px",
          margin: "0 auto 28px",
          borderRadius: "16px",
          border: `3px solid ${packTheme.accent}`,
          cursor: canOpen ? "pointer" : "not-allowed",
          opacity: canOpen ? 1 : 0.45,
          transform: opening ? "scale(0.94)" : "scale(1)",
          transition: "transform 0.12s ease",
          boxShadow: `0 0 30px 4px ${packTheme.glow}, 0 12px 30px rgba(0,0,0,0.4)`,
        }}
      >
        <PackArt theme={packTheme} flash={packFlash} />
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

      <div style={{ marginTop: "18px" }}>
        <button
          onClick={buyExtraPack}
          disabled={!canBuyExtra}
          style={{
            background: "transparent",
            color: canBuyExtra ? "#ffd95e" : "#665f80",
            border: `1px solid ${canBuyExtra ? "rgba(255,217,94,0.5)" : "rgba(255,255,255,0.12)"}`,
            borderRadius: "999px",
            padding: "10px 24px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: canBuyExtra ? "pointer" : "not-allowed",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span>{String.fromCodePoint(0x1fa99)}</span>
          Comprar sobre extra — {EXTRA_PACK_COST}
        </button>
      </div>

      <div
        style={{
          marginTop: "32px",
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

function CollectionView({ cards, collection, ownedUnique, totalUnique, coins, onSell }) {
  const completion = totalUnique ? Math.round((ownedUnique / totalUnique) * 100) : 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "20px", flexWrap: "wrap", gap: "8px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Mi colección</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ color: "#ffd95e", fontSize: "13px", fontWeight: 700 }}>
            {String.fromCodePoint(0x1fa99)} {coins}
          </span>
          <span style={{ color: "#c9c3e0", fontSize: "14px" }}>
            {ownedUnique} / {totalUnique} cartas ({completion}%)
          </span>
        </div>
      </div>
      <p style={{ color: "#8d87a8", fontSize: "12px", marginTop: "-8px", marginBottom: "18px" }}>
        Podés vender las cartas que te sobren a cambio de monedas.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
          gap: "14px",
        }}
      >
        {cards.map((card) => {
          const owned = collection[card.id] || 0;
          const price = sellPriceFor(card.rarity);
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
              {owned > 0 && (
                <button
                  onClick={() => onSell(card.id)}
                  style={{
                    marginTop: "6px",
                    width: "100%",
                    background: "rgba(255,217,94,0.12)",
                    color: "#ffd95e",
                    border: "1px solid rgba(255,217,94,0.3)",
                    borderRadius: "999px",
                    padding: "4px 0",
                    fontSize: "10px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Vender · {price} {String.fromCodePoint(0x1fa99)}
                </button>
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
  const particleColor = particleColorFor(card.rarity);

  useEffect(() => {
    setStage("flash");
    const t1 = setTimeout(() => setStage("popping"), isBig ? 130 : 50);
    const t2 = setTimeout(() => setStage("settled"), isBig ? 600 : 380);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [revealKey, isBig]);

  const popTransform =
    stage === "flash"
      ? "scale(0.2) rotate(-8deg)"
      : stage === "popping"
      ? isBig
        ? "scale(1.18) rotate(2deg)"
        : "scale(1.08) rotate(-1deg)"
      : "scale(1) rotate(0deg)";

  return (
    <div
      style={{
        position: "relative",
        width: "240px",
        textAlign: "center",
      }}
    >
      <FlashOverlay active={stage === "flash"} color={particleColor} intensity={isBig ? 0.85 : 0.35} />
      {stage !== "flash" && <ParticleBurst seed={revealKey} count={particleCountFor(card.rarity)} color={particleColor} />}

      <div
        style={{
          transform: popTransform,
          opacity: stage === "flash" ? 0 : 1,
          transition:
            stage === "flash"
              ? "none"
              : stage === "popping"
              ? `transform ${isBig ? 0.4 : 0.28}s cubic-bezier(0.17, 0.89, 0.32, 1.49), opacity 0.2s ease`
              : "transform 0.3s cubic-bezier(0.34, 1.2, 0.4, 1)",
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
  const current = cards[revealIndex] || cards[0];

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
    </div>
  );
}
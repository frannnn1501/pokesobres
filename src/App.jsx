import React, { useState, useEffect, useCallback, useRef } from "react";
import { BASE1_CARDS } from "./base1data";
import { auth, db, googleProvider } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, runTransaction, collection as fsCollection, query, where, getDocs, addDoc, onSnapshot } from "firebase/firestore";

const POKEMON_NUMBERS = new Set([
  "1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16",
  "17","18","19","20","21","22","23","24","25","26","27","28","29","30",
  "31","32","33","34","35","36","37","38","39","40","41","42","43","44",
  "45","46","47","48","49","50","51","52","53","54","55","56","57","58",
  "59","60","61","62","63","64","65","66","67","68","69"
]);

function isPokemonCard(number) {
  return POKEMON_NUMBERS.has(String(number));
}

function buildCards() {
  const base = BASE1_CARDS.map(([number, name, rarity]) => ({
    id: `base1-${number}`,
    name,
    number,
    rarity,
    isShiny: false,
    supertype: "Pokémon/Trainer/Energy",
    images: {
      small: `https://images.pokemontcg.io/base1/${number}.png`,
      large: `https://images.pokemontcg.io/base1/${number}_hires.png`,
    },
  }));

  // Agregar variantes shiny para cada Pokémon (IDs separados, entradas propias en la colección)
  const shinies = BASE1_CARDS
    .filter(([number]) => isPokemonCard(number))
    .map(([number, name, rarity]) => ({
      id: `base1-${number}-shiny`,
      name: `✨ ${name}`,
      number,
      rarity: rarity === "Common" || rarity === "Uncommon" ? rarity : rarity, // mantiene rareza base
      isShiny: true,
      supertype: "Pokémon/Trainer/Energy",
      images: {
        small: `https://images.pokemontcg.io/base1/${number}.png`,
        large: `https://images.pokemontcg.io/base1/${number}_hires.png`,
      },
    }));

  return [...base, ...shinies];
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
  Common: 57,
  Uncommon: 30,
  Rare: 11,
  "Rare Holo": 2,
};
const SHINY_CHANCE = 0.01; // 1% de chance de que cualquier Pokémon común/uncommon salga shiny

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

function isEnergyCard(card) {
  return card.name.endsWith("Energy");
}

function maybeMakeShiny(card, allCards) {
  if (!isPokemonCard(card.number)) return card;
  if (card.isShiny) return card;
  if (Math.random() < SHINY_CHANCE) {
    const shiny = allCards.find((c) => c.id === `${card.id}-shiny`);
    return shiny || card;
  }
  return card;
}

function drawPack(cards) {
  const energies = cards.filter((c) => c.rarity === "Common" && isEnergyCard(c) && !c.isShiny);
  const commonsNonEnergy = cards.filter((c) => c.rarity === "Common" && !isEnergyCard(c) && !c.isShiny);
  const others = cards.filter((c) => c.rarity !== "Common" && !c.isShiny);

  const pulled = [];
  const includeEnergy = energies.length > 0 && Math.random() < 0.6;
  const commonSlots = CARDS_PER_PACK - 1 - (includeEnergy ? 1 : 0);

  for (let i = 0; i < commonSlots; i++) {
    const card = weightedPick(commonsNonEnergy.length ? commonsNonEnergy : cards.filter((c) => !c.isShiny));
    pulled.push(maybeMakeShiny(card, cards));
  }
  if (includeEnergy) {
    pulled.push(energies[Math.floor(Math.random() * energies.length)]);
  }
  const rare = weightedPick(others.length ? others : cards.filter((c) => !c.isShiny));
  pulled.push(maybeMakeShiny(rare, cards));
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
  const [listings, setListings] = useState([]);
  const [marketError, setMarketError] = useState("");
  const [incomingTrades, setIncomingTrades] = useState([]);
  const [outgoingTrades, setOutgoingTrades] = useState([]);
  const [tradeError, setTradeError] = useState("");
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
          fsCollection(db, "friendRequests"),
          where("fromUid", "==", user.uid),
          where("toUid", "==", targetUid),
          where("status", "==", "pending")
        );
        const existing = await getDocs(existingQuery);
        if (!existing.empty) {
          return { ok: false, message: "Ya le mandaste una solicitud, esperá a que responda." };
        }

        await addDoc(fsCollection(db, "friendRequests"), {
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
      fsCollection(db, "friendRequests"),
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
      fsCollection(db, "friendRequests"),
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

  // Listener en tiempo real de todas las listings activas del mercado
  useEffect(() => {
    const q = query(
      fsCollection(db, "listings"),
      where("status", "==", "active")
    );
    const unsub = onSnapshot(q, (snap) => {
      setListings(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => {});
    return () => unsub();
  }, []);

  // Trades que me proponen a mí, pendientes
  useEffect(() => {
    if (!user) { setIncomingTrades([]); return; }
    const q = query(
      fsCollection(db, "trades"),
      where("toUid", "==", user.uid),
      where("status", "==", "pending")
    );
    const unsub = onSnapshot(q, (snap) => {
      setIncomingTrades(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => {});
    return () => unsub();
  }, [user]);

  // Trades que yo propuse, pendientes (para poder cancelarlas)
  useEffect(() => {
    if (!user) { setOutgoingTrades([]); return; }
    const q = query(
      fsCollection(db, "trades"),
      where("fromUid", "==", user.uid),
      where("status", "==", "pending")
    );
    const unsub = onSnapshot(q, (snap) => {
      setOutgoingTrades(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => {});
    return () => unsub();
  }, [user]);

  // Mis propios trades que ya fueron aceptados por el otro: tengo que aplicar
  // mi parte del intercambio (igual que con las solicitudes de amistad).
  useEffect(() => {
    if (!user) return;
    const q = query(
      fsCollection(db, "trades"),
      where("fromUid", "==", user.uid),
      where("status", "==", "accepted")
    );
    const unsub = onSnapshot(q, async (snap) => {
      for (const docSnap of snap.docs) {
        const trade = docSnap.data();
        if (trade.fromApplied) continue;
        try {
          const myRef = doc(db, "users", user.uid);
          await runTransaction(db, async (tx) => {
            const mySnap = await tx.get(myRef);
            const myData = mySnap.exists() ? mySnap.data() : emptyUserDoc();
            const newCollection = { ...(myData.collection || {}) };
            // Pierdo lo que ofrecí
            for (const [cardId, qty] of Object.entries(trade.offerCards || {})) {
              newCollection[cardId] = (newCollection[cardId] || 0) - qty;
              if (newCollection[cardId] <= 0) delete newCollection[cardId];
            }
            // Gano lo que pedí
            for (const [cardId, qty] of Object.entries(trade.requestCards || {})) {
              newCollection[cardId] = (newCollection[cardId] || 0) + qty;
            }
            const newCoins = (myData.coins || 0) - (trade.offerCoins || 0) + (trade.requestCoins || 0);
            tx.update(myRef, { collection: newCollection, coins: newCoins });
            tx.update(doc(db, "trades", docSnap.id), { fromApplied: true });
          });
          setCollection((prev) => {
            const next = { ...prev };
            for (const [cardId, qty] of Object.entries(trade.offerCards || {})) {
              next[cardId] = (next[cardId] || 0) - qty;
              if (next[cardId] <= 0) delete next[cardId];
            }
            for (const [cardId, qty] of Object.entries(trade.requestCards || {})) {
              next[cardId] = (next[cardId] || 0) + qty;
            }
            return next;
          });
          setCoins((c) => c - (trade.offerCoins || 0) + (trade.requestCoins || 0));
        } catch {}
      }
    }, () => {});
    return () => unsub();
  }, [user]);

  const proposeTrade = useCallback(
    async (toUsername, offerCards, offerCoins, requestCards, requestCoins) => {
      if (!user || !username) return { ok: false, message: "Necesitás tu propio username primero." };
      const targetName = toUsername.trim().toLowerCase();
      if (!targetName) return { ok: false, message: "Elegí un amigo." };
      if (targetName === username) return { ok: false, message: "No podés tradear con vos mismo." };

      const hasOffer = Object.keys(offerCards).length > 0 || offerCoins > 0;
      const hasRequest = Object.keys(requestCards).length > 0 || requestCoins > 0;
      if (!hasOffer && !hasRequest) return { ok: false, message: "Agregá algo para ofrecer o pedir." };

      // Verificar que tengo las cartas y monedas que ofrezco
      for (const [cardId, qty] of Object.entries(offerCards)) {
        if ((collection[cardId] || 0) < qty) return { ok: false, message: "No tenés suficientes copias de esa carta." };
      }
      if (offerCoins > coins) return { ok: false, message: "No tenés suficientes monedas para ofrecer." };

      try {
        const usernameSnap = await getDoc(doc(db, "usernames", targetName));
        if (!usernameSnap.exists()) return { ok: false, message: "No existe ningún usuario con ese nombre." };
        const targetUid = usernameSnap.data().uid;
        if (!friends[targetUid]) return { ok: false, message: "Solo podés tradear con tus amigos." };

        await addDoc(fsCollection(db, "trades"), {
          fromUid: user.uid,
          fromUsername: username,
          toUid: targetUid,
          toUsername: targetName,
          offerCards,
          offerCoins: offerCoins || 0,
          requestCards,
          requestCoins: requestCoins || 0,
          status: "pending",
          fromApplied: false,
          createdAt: todayStr(),
        });
        return { ok: true, message: `Propuesta enviada a ${targetName}.` };
      } catch (err) {
        return { ok: false, message: "No se pudo enviar la propuesta. Probá de nuevo." };
      }
    },
    [user, username, collection, coins, friends]
  );

  const respondTrade = useCallback(
    async (trade, accept) => {
      if (!user) return;
      const tradeRef = doc(db, "trades", trade.id);
      try {
        if (accept) {
          // Verificar que yo (destinatario) tengo lo que se me está pidiendo
          for (const [cardId, qty] of Object.entries(trade.requestCards || {})) {
            if ((collection[cardId] || 0) < qty) {
              setTradeError("Ya no tenés las cartas que te pedían. No se pudo aceptar.");
              return;
            }
          }
          if ((trade.requestCoins || 0) > coins) {
            setTradeError("Ya no tenés suficientes monedas. No se pudo aceptar.");
            return;
          }

          const myRef = doc(db, "users", user.uid);
          await runTransaction(db, async (tx) => {
            const mySnap = await tx.get(myRef);
            const myData = mySnap.exists() ? mySnap.data() : emptyUserDoc();
            const newCollection = { ...(myData.collection || {}) };
            // Pierdo lo que me pidieron (requestCards/requestCoins son lo que YO doy al aceptar)
            for (const [cardId, qty] of Object.entries(trade.requestCards || {})) {
              newCollection[cardId] = (newCollection[cardId] || 0) - qty;
              if (newCollection[cardId] <= 0) delete newCollection[cardId];
            }
            // Gano lo que me ofrecieron
            for (const [cardId, qty] of Object.entries(trade.offerCards || {})) {
              newCollection[cardId] = (newCollection[cardId] || 0) + qty;
            }
            const newCoins = (myData.coins || 0) - (trade.requestCoins || 0) + (trade.offerCoins || 0);
            tx.update(myRef, { collection: newCollection, coins: newCoins });
            tx.update(tradeRef, { status: "accepted" });
          });
          setCollection((prev) => {
            const next = { ...prev };
            for (const [cardId, qty] of Object.entries(trade.requestCards || {})) {
              next[cardId] = (next[cardId] || 0) - qty;
              if (next[cardId] <= 0) delete next[cardId];
            }
            for (const [cardId, qty] of Object.entries(trade.offerCards || {})) {
              next[cardId] = (next[cardId] || 0) + qty;
            }
            return next;
          });
          setCoins((c) => c - (trade.requestCoins || 0) + (trade.offerCoins || 0));
        } else {
          await updateDoc(tradeRef, { status: "rejected" });
        }
      } catch (err) {
        setTradeError("No se pudo procesar el trade. Probá de nuevo.");
      }
    },
    [user, collection, coins]
  );

  const cancelTrade = useCallback(async (tradeId) => {
    try {
      await updateDoc(doc(db, "trades", tradeId), { status: "cancelled" });
    } catch (err) {
      setTradeError("No se pudo cancelar. Probá de nuevo.");
    }
  }, []);

  const createListing = useCallback(
    async (cardId, price) => {
      if (!user || !username) return { ok: false, message: "Necesitás estar logueado." };
      const card = cards.find((c) => c.id === cardId);
      if (!card) return { ok: false, message: "Carta no encontrada." };
      const parsedPrice = parseInt(price, 10);
      if (isNaN(parsedPrice) || parsedPrice < 1) return { ok: false, message: "El precio debe ser al menos 1 moneda." };

      const userRef = doc(db, "users", user.uid);
      try {
        await runTransaction(db, async (tx) => {
          const userSnap = await tx.get(userRef);
          const data = userSnap.exists() ? userSnap.data() : emptyUserDoc();
          const owned = (data.collection || {})[cardId] || 0;
          if (owned <= 1) throw new Error("NOT_ENOUGH_COPIES");

          const newCollection = { ...(data.collection || {}) };
          newCollection[cardId] = owned - 1;

          tx.update(userRef, { collection: newCollection });
          tx.set(doc(fsCollection(db, "listings")), {
            sellerUid: user.uid,
            sellerUsername: username,
            cardId,
            cardName: card.name,
            cardRarity: card.rarity,
            cardImage: card.images.small,
            price: parsedPrice,
            status: "active",
            createdAt: todayStr(),
          });
        });
        setCollection((prev) => {
          const next = { ...prev };
          next[cardId] = (next[cardId] || 1) - 1;
          return next;
        });
        return { ok: true, message: `Carta publicada por ${parsedPrice} monedas.` };
      } catch (err) {
        if (err.message === "NOT_ENOUGH_COPIES") return { ok: false, message: "No podés publicar tu última copia de esa carta." };
        return { ok: false, message: "No se pudo publicar. Probá de nuevo." };
      }
    },
    [user, username, cards]
  );

  const cancelListing = useCallback(
    async (listingId, cardId) => {
      if (!user) return;
      const listingRef = doc(db, "listings", listingId);
      const userRef = doc(db, "users", user.uid);
      try {
        await runTransaction(db, async (tx) => {
          const listingSnap = await tx.get(listingRef);
          if (!listingSnap.exists() || listingSnap.data().sellerUid !== user.uid) throw new Error("NOT_YOURS");
          if (listingSnap.data().status !== "active") throw new Error("NOT_ACTIVE");

          const userSnap = await tx.get(userRef);
          const data = userSnap.exists() ? userSnap.data() : emptyUserDoc();
          const newCollection = { ...(data.collection || {}) };
          newCollection[cardId] = (newCollection[cardId] || 0) + 1;

          tx.update(listingRef, { status: "cancelled" });
          tx.update(userRef, { collection: newCollection });
        });
        setCollection((prev) => ({ ...prev, [cardId]: (prev[cardId] || 0) + 1 }));
      } catch (err) {
        setMarketError("No se pudo cancelar la publicación. Probá de nuevo.");
      }
    },
    [user]
  );

  const buyListing = useCallback(
    async (listing) => {
      if (!user) return { ok: false, message: "Necesitás estar logueado." };
      if (listing.sellerUid === user.uid) return { ok: false, message: "No podés comprar tu propia carta." };
      if (coins < listing.price) return { ok: false, message: "No tenés suficientes monedas." };

      const listingRef = doc(db, "listings", listing.id);
      const buyerRef = doc(db, "users", user.uid);
      const sellerRef = doc(db, "users", listing.sellerUid);
      try {
        await runTransaction(db, async (tx) => {
          const listingSnap = await tx.get(listingRef);
          if (!listingSnap.exists() || listingSnap.data().status !== "active") throw new Error("NOT_AVAILABLE");

          const buyerSnap = await tx.get(buyerRef);
          const buyerData = buyerSnap.exists() ? buyerSnap.data() : emptyUserDoc();
          if ((buyerData.coins || 0) < listing.price) throw new Error("NOT_ENOUGH_COINS");

          const sellerSnap = await tx.get(sellerRef);
          const sellerData = sellerSnap.exists() ? sellerSnap.data() : emptyUserDoc();

          const newBuyerCollection = { ...(buyerData.collection || {}) };
          newBuyerCollection[listing.cardId] = (newBuyerCollection[listing.cardId] || 0) + 1;

          tx.update(listingRef, { status: "sold", buyerUid: user.uid, buyerUsername: username });
          tx.update(buyerRef, {
            coins: (buyerData.coins || 0) - listing.price,
            collection: newBuyerCollection,
          });
          tx.update(sellerRef, {
            coins: (sellerData.coins || 0) + listing.price,
          });
        });

        setCoins((c) => c - listing.price);
        setCollection((prev) => ({ ...prev, [listing.cardId]: (prev[listing.cardId] || 0) + 1 }));
        playTone(523, 0.1, "sine", 0.04);
        playTone(659, 0.15, "sine", 0.04);
        return { ok: true, message: `¡Compraste ${listing.cardName}!` };
      } catch (err) {
        if (err.message === "NOT_AVAILABLE") return { ok: false, message: "Esa carta ya no está disponible." };
        if (err.message === "NOT_ENOUGH_COINS") return { ok: false, message: "No tenés suficientes monedas." };
        return { ok: false, message: "No se pudo completar la compra. Probá de nuevo." };
      }
    },
    [user, username, coins, playTone]
  );

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
          if (owned <= 1) {
            throw new Error("NOT_ENOUGH_COPIES");
          }
          const newCollection = { ...data.collection };
          newCollection[cardId] = owned - 1;
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
        if (err.message === "NOT_ENOUGH_COPIES") {
          setAuthError("No podés vender tu última copia de esa carta.");
        } else {
          setAuthError("No se pudo vender la carta. Probá de nuevo.");
        }
      }
    },
    [user, cards, playTone]
  );

  const sellDuplicates = useCallback(
    async (raritiesFilter) => {
      if (!user) return { ok: false, message: "No estás logueado." };
      const ref = doc(db, "users", user.uid);
      try {
        const result = await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          const data = snap.exists() ? snap.data() : emptyUserDoc();
          const col = { ...(data.collection || {}) };
          let totalCoins = 0;
          let totalCards = 0;

          for (const [cardId, qty] of Object.entries(col)) {
            if (qty <= 1) continue;
            const card = cards.find((c) => c.id === cardId);
            if (!card) continue;
            if (!raritiesFilter.includes(card.rarity)) continue;
            const toSell = qty - 1;
            const price = sellPriceFor(card.rarity) * toSell;
            col[cardId] = 1;
            totalCoins += price;
            totalCards += toSell;
          }

          if (totalCards === 0) throw new Error("NOTHING_TO_SELL");

          const newData = { ...data, collection: col, coins: (data.coins || 0) + totalCoins };
          tx.set(ref, newData);
          return { newData, totalCoins, totalCards };
        });

        setCollection(result.newData.collection);
        setCoins(result.newData.coins);
        setProfile(result.newData);
        playTone(523, 0.1, "sine", 0.04);
        playTone(659, 0.15, "sine", 0.04);
        return { ok: true, message: `Vendiste ${result.totalCards} cartas por ${result.totalCoins} monedas.` };
      } catch (err) {
        if (err.message === "NOTHING_TO_SELL")
          return { ok: false, message: "No tenés duplicados de esas rarezas para vender." };
        return { ok: false, message: "No se pudo vender. Probá de nuevo." };
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
              style={styles.navBtn(view === "market")}
              onClick={() => setView("market")}
            >
              Mercado
            </button>
            <button
              style={{ ...styles.navBtn(view === "trades"), position: "relative" }}
              onClick={() => setView("trades")}
            >
              Trades
              {incomingTrades.length > 0 && (
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
                  {incomingTrades.length}
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
            onSellDuplicates={sellDuplicates}
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
        {authChecked && user && !needsUsername && loadState === "ready" && view === "market" && (
          <MarketView
            listings={listings}
            cards={cards}
            myUid={user.uid}
            myCollection={collection}
            coins={coins}
            marketError={marketError}
            onCreateListing={createListing}
            onCancelListing={cancelListing}
            onBuyListing={buyListing}
          />
        )}
        {authChecked && user && !needsUsername && loadState === "ready" && view === "trades" && (
          <TradesView
            cards={cards}
            friends={friends}
            friendProfiles={friendProfiles}
            myCollection={collection}
            coins={coins}
            incomingTrades={incomingTrades}
            outgoingTrades={outgoingTrades}
            tradeError={tradeError}
            onPropose={proposeTrade}
            onRespond={respondTrade}
            onCancel={cancelTrade}
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

function MarketView({ listings, cards, myUid, myCollection, coins, marketError, onCreateListing, onCancelListing, onBuyListing }) {
  const [tab, setTab] = useState("explore");
  const [sellCardId, setSellCardId] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [sellStatus, setSellStatus] = useState(null);
  const [buyStatus, setBuyStatus] = useState({});

  const myListings = listings.filter((l) => l.sellerUid === myUid);
  const otherListings = listings.filter((l) => l.sellerUid !== myUid);
  const ownedCards = cards.filter((c) => (myCollection[c.id] || 0) > 1);

  const handleSell = async () => {
    if (!sellCardId) { setSellStatus({ ok: false, message: "Elegí una carta." }); return; }
    setSellStatus(null);
    const result = await onCreateListing(sellCardId, sellPrice);
    setSellStatus(result);
    if (result.ok) { setSellCardId(""); setSellPrice(""); }
  };

  const handleBuy = async (listing) => {
    setBuyStatus((s) => ({ ...s, [listing.id]: "buying" }));
    const result = await onBuyListing(listing);
    setBuyStatus((s) => ({ ...s, [listing.id]: result.ok ? "ok" : result.message }));
    setTimeout(() => setBuyStatus((s) => { const n = { ...s }; delete n[listing.id]; return n; }), 3000);
  };

  const tabBtn = (id, label) => (
    <button
      onClick={() => setTab(id)}
      style={{
        background: tab === id ? "#ffd95e" : "transparent",
        color: tab === id ? "#241b3d" : "#c9c3e0",
        border: tab === id ? "none" : "1px solid rgba(255,255,255,0.15)",
        borderRadius: "999px",
        padding: "8px 18px",
        fontSize: "13px",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >{label}</button>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Mercado</h2>
        <div style={{ display: "flex", gap: "8px" }}>
          {tabBtn("explore", `Explorar (${otherListings.length})`)}
          {tabBtn("mine", `Mis publicaciones (${myListings.length})`)}
          {tabBtn("sell", "Publicar carta")}
        </div>
      </div>

      {marketError && <p style={{ color: "#f0a0a0", fontSize: "13px", marginBottom: "16px" }}>{marketError}</p>}

      {tab === "explore" && (
        <div>
          {otherListings.length === 0 ? (
            <p style={{ color: "#8d87a8", fontSize: "13px" }}>No hay cartas en venta por otros jugadores por el momento.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "14px" }}>
              {otherListings.sort((a, b) => a.price - b.price).map((listing) => {
                const canAfford = coins >= listing.price;
                const status = buyStatus[listing.id];
                return (
                  <div key={listing.id} style={{ background: "rgba(255,255,255,0.04)", borderRadius: "10px", padding: "10px", textAlign: "center", border: `1px solid ${rarityColor(listing.cardRarity)}44` }}>
                    <img
                      src={listing.cardImage}
                      alt={listing.cardName}
                      onError={(e) => { e.target.onerror = null; e.target.src = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#352a55"/></svg>'); }}
                      style={{ width: "100%", borderRadius: "6px", marginBottom: "6px" }}
                    />
                    <div style={{ fontSize: "11px", fontWeight: 600, lineHeight: 1.2, marginBottom: "3px" }}>{listing.cardName}</div>
                    <div style={{ fontSize: "10px", color: rarityColor(listing.cardRarity), marginBottom: "3px" }}>{listing.cardRarity}</div>
                    <div style={{ fontSize: "10px", color: "#8d87a8", marginBottom: "8px" }}>@{listing.sellerUsername}</div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#ffd95e", marginBottom: "8px" }}>
                      {String.fromCodePoint(0x1fa99)} {listing.price}
                    </div>
                    {status === "buying" ? (
                      <div style={{ fontSize: "11px", color: "#c9c3e0" }}>Comprando...</div>
                    ) : status === "ok" ? (
                      <div style={{ fontSize: "11px", color: "#a8e6a1" }}>¡Comprado!</div>
                    ) : status ? (
                      <div style={{ fontSize: "10px", color: "#f0a0a0" }}>{status}</div>
                    ) : (
                      <button
                        onClick={() => handleBuy(listing)}
                        disabled={!canAfford}
                        style={{
                          width: "100%",
                          background: canAfford ? "rgba(255,217,94,0.15)" : "rgba(255,255,255,0.05)",
                          color: canAfford ? "#ffd95e" : "#665f80",
                          border: `1px solid ${canAfford ? "rgba(255,217,94,0.4)" : "rgba(255,255,255,0.1)"}`,
                          borderRadius: "999px",
                          padding: "5px 0",
                          fontSize: "11px",
                          fontWeight: 700,
                          cursor: canAfford ? "pointer" : "not-allowed",
                        }}
                      >
                        {canAfford ? "Comprar" : "Sin monedas"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "mine" && (
        <div>
          {myListings.length === 0 ? (
            <p style={{ color: "#8d87a8", fontSize: "13px" }}>No tenés cartas publicadas. Usá "Publicar carta" para vender.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "14px" }}>
              {myListings.map((listing) => (
                <div key={listing.id} style={{ background: "rgba(255,255,255,0.04)", borderRadius: "10px", padding: "10px", textAlign: "center", border: `1px solid ${rarityColor(listing.cardRarity)}44` }}>
                  <img
                    src={listing.cardImage}
                    alt={listing.cardName}
                    onError={(e) => { e.target.onerror = null; e.target.src = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#352a55"/></svg>'); }}
                    style={{ width: "100%", borderRadius: "6px", marginBottom: "6px" }}
                  />
                  <div style={{ fontSize: "11px", fontWeight: 600, lineHeight: 1.2, marginBottom: "4px" }}>{listing.cardName}</div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#ffd95e", marginBottom: "8px" }}>
                    {String.fromCodePoint(0x1fa99)} {listing.price}
                  </div>
                  <button
                    onClick={() => onCancelListing(listing.id, listing.cardId)}
                    style={{
                      width: "100%",
                      background: "transparent",
                      color: "#f0a0a0",
                      border: "1px solid rgba(240,160,160,0.3)",
                      borderRadius: "999px",
                      padding: "5px 0",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "sell" && (
        <div style={{ maxWidth: "400px" }}>
          <p style={{ color: "#8d87a8", fontSize: "13px", marginBottom: "20px" }}>
            Elegí una carta de tu colección y poné el precio. La carta sale de tu inventario al publicarla — si la cancelás, vuelve.
          </p>
          {ownedCards.length === 0 ? (
            <p style={{ color: "#f0a0a0", fontSize: "13px" }}>No tenés cartas para vender. ¡Abrí más sobres!</p>
          ) : (
            <>
              <select
                value={sellCardId}
                onChange={(e) => setSellCardId(e.target.value)}
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  color: "#f4f1ea",
                  fontSize: "14px",
                  marginBottom: "12px",
                }}
              >
                <option value="">— Elegí una carta —</option>
                {ownedCards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.rarity}) ×{myCollection[c.id]}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                placeholder="Precio en monedas"
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  color: "#f4f1ea",
                  fontSize: "14px",
                  marginBottom: "12px",
                  boxSizing: "border-box",
                }}
              />
              {sellStatus && (
                <p style={{ fontSize: "13px", color: sellStatus.ok ? "#a8e6a1" : "#f0a0a0", marginBottom: "12px" }}>
                  {sellStatus.message}
                </p>
              )}
              <button
                onClick={handleSell}
                disabled={!sellCardId || !sellPrice}
                style={{
                  width: "100%",
                  background: sellCardId && sellPrice ? "#ffd95e" : "rgba(255,255,255,0.1)",
                  color: sellCardId && sellPrice ? "#241b3d" : "#888",
                  border: "none",
                  borderRadius: "999px",
                  padding: "12px 0",
                  fontWeight: 700,
                  fontSize: "15px",
                  cursor: sellCardId && sellPrice ? "pointer" : "not-allowed",
                }}
              >
                Publicar en el mercado
              </button>
            </>
          )}
        </div>
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

function TradesView({ cards, friends, friendProfiles, myCollection, coins, incomingTrades, outgoingTrades, tradeError, onPropose, onRespond, onCancel }) {
  const [tab, setTab] = useState("propose");
  const friendUids = Object.keys(friends || {});

  const cardById = useCallback((id) => cards.find((c) => c.id === id), [cards]);

  const tabBtn = (id, label) => (
    <button
      onClick={() => setTab(id)}
      style={{
        background: tab === id ? "#ffd95e" : "transparent",
        color: tab === id ? "#241b3d" : "#c9c3e0",
        border: tab === id ? "none" : "1px solid rgba(255,255,255,0.15)",
        borderRadius: "999px",
        padding: "8px 18px",
        fontSize: "13px",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >{label}</button>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Trades</h2>
        <div style={{ display: "flex", gap: "8px" }}>
          {tabBtn("propose", "Proponer")}
          {tabBtn("incoming", `Recibidas (${incomingTrades.length})`)}
          {tabBtn("outgoing", `Enviadas (${outgoingTrades.length})`)}
        </div>
      </div>

      {tradeError && <p style={{ color: "#f0a0a0", fontSize: "13px", marginBottom: "16px" }}>{tradeError}</p>}

      {tab === "propose" && (
        <TradeProposeForm
          cards={cards}
          friendUids={friendUids}
          friendProfiles={friendProfiles}
          myCollection={myCollection}
          coins={coins}
          onPropose={onPropose}
        />
      )}

      {tab === "incoming" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {incomingTrades.length === 0 ? (
            <p style={{ color: "#8d87a8", fontSize: "13px" }}>No tenés propuestas de trade pendientes.</p>
          ) : (
            incomingTrades.map((trade) => (
              <TradeCard key={trade.id} trade={trade} cardById={cardById} perspective="incoming">
                <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                  <button
                    onClick={() => onRespond(trade, true)}
                    style={{ background: "#a8e6a1", color: "#1c4d24", border: "none", borderRadius: "999px", padding: "8px 18px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
                  >
                    Aceptar
                  </button>
                  <button
                    onClick={() => onRespond(trade, false)}
                    style={{ background: "transparent", color: "#c9c3e0", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "999px", padding: "8px 18px", fontSize: "13px", cursor: "pointer" }}
                  >
                    Rechazar
                  </button>
                </div>
              </TradeCard>
            ))
          )}
        </div>
      )}

      {tab === "outgoing" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {outgoingTrades.length === 0 ? (
            <p style={{ color: "#8d87a8", fontSize: "13px" }}>No tenés propuestas enviadas pendientes.</p>
          ) : (
            outgoingTrades.map((trade) => (
              <TradeCard key={trade.id} trade={trade} cardById={cardById} perspective="outgoing">
                <button
                  onClick={() => onCancel(trade.id)}
                  style={{ marginTop: "10px", background: "transparent", color: "#f0a0a0", border: "1px solid rgba(240,160,160,0.3)", borderRadius: "999px", padding: "8px 18px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
                >
                  Cancelar propuesta
                </button>
              </TradeCard>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TradeCard({ trade, cardById, perspective, children }) {
  const otherUsername = perspective === "incoming" ? trade.fromUsername : trade.toUsername;
  const youGive = perspective === "incoming" ? trade.requestCards : trade.offerCards;
  const youGiveCoins = perspective === "incoming" ? trade.requestCoins : trade.offerCoins;
  const youGet = perspective === "incoming" ? trade.offerCards : trade.requestCards;
  const youGetCoins = perspective === "incoming" ? trade.offerCoins : trade.requestCoins;

  return (
    <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: "12px", padding: "16px" }}>
      <p style={{ fontSize: "13px", color: "#c9c3e0", marginBottom: "10px" }}>
        {perspective === "incoming" ? `${otherUsername} te propone:` : `Le propusiste a ${otherUsername}:`}
      </p>
      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "11px", color: "#f0a0a0", fontWeight: 700, marginBottom: "6px" }}>VOS DAS</div>
          <TradeSideList cardsMap={youGive} coins={youGiveCoins} cardById={cardById} />
        </div>
        <div>
          <div style={{ fontSize: "11px", color: "#a8e6a1", fontWeight: 700, marginBottom: "6px" }}>VOS RECIBÍS</div>
          <TradeSideList cardsMap={youGet} coins={youGetCoins} cardById={cardById} />
        </div>
      </div>
      {children}
    </div>
  );
}

function TradeSideList({ cardsMap, coins, cardById }) {
  const entries = Object.entries(cardsMap || {});
  if (entries.length === 0 && !coins) {
    return <p style={{ fontSize: "12px", color: "#8d87a8" }}>Nada</p>;
  }
  return (
    <div style={{ fontSize: "12px", color: "#f4f1ea" }}>
      {entries.map(([cardId, qty]) => {
        const card = cardById(cardId);
        return (
          <div key={cardId}>
            {card ? card.name : cardId} ×{qty}
          </div>
        );
      })}
      {coins > 0 && <div style={{ color: "#ffd95e" }}>{String.fromCodePoint(0x1fa99)} {coins}</div>}
    </div>
  );
}

function TradeProposeForm({ cards, friendUids, friendProfiles, myCollection, coins, onPropose }) {
  const [targetUid, setTargetUid] = useState("");
  const [offerCards, setOfferCards] = useState({});
  const [offerCoins, setOfferCoins] = useState("");
  const [requestCards, setRequestCards] = useState({});
  const [requestCoins, setRequestCoins] = useState("");
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);

  const friendProfile = targetUid ? friendProfiles[targetUid] : null;
  const myOwnedCards = cards.filter((c) => (myCollection[c.id] || 0) > 0);
  const friendOwnedCards = friendProfile ? cards.filter((c) => (friendProfile.collection || {})[c.id] > 0) : [];

  const adjustOffer = (cardId, delta, max) => {
    setOfferCards((prev) => {
      const next = { ...prev };
      const newQty = (next[cardId] || 0) + delta;
      if (newQty <= 0) delete next[cardId];
      else if (newQty <= max) next[cardId] = newQty;
      return next;
    });
  };

  const adjustRequest = (cardId, delta, max) => {
    setRequestCards((prev) => {
      const next = { ...prev };
      const newQty = (next[cardId] || 0) + delta;
      if (newQty <= 0) delete next[cardId];
      else if (newQty <= max) next[cardId] = newQty;
      return next;
    });
  };

  const handleSend = async () => {
    if (!friendProfile || sending) return;
    setSending(true);
    setStatus(null);
    const result = await onPropose(
      friendProfile.username,
      offerCards,
      parseInt(offerCoins, 10) || 0,
      requestCards,
      parseInt(requestCoins, 10) || 0
    );
    setStatus(result);
    setSending(false);
    if (result.ok) {
      setOfferCards({});
      setOfferCoins("");
      setRequestCards({});
      setRequestCoins("");
    }
  };

  if (friendUids.length === 0) {
    return <p style={{ color: "#8d87a8", fontSize: "13px" }}>Necesitás tener amigos agregados para proponerles un trade.</p>;
  }

  return (
    <div>
      <select
        value={targetUid}
        onChange={(e) => { setTargetUid(e.target.value); setOfferCards({}); setRequestCards({}); }}
        style={{
          width: "100%",
          maxWidth: "320px",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: "10px",
          padding: "10px 14px",
          color: "#f4f1ea",
          fontSize: "14px",
          marginBottom: "20px",
        }}
      >
        <option value="">— Elegí un amigo —</option>
        {friendUids.map((uid) => (
          <option key={uid} value={uid}>
            {friendProfiles[uid]?.username || friendProfiles[uid]?.displayName || "Cargando..."}
          </option>
        ))}
      </select>

      {friendProfile && (
        <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "280px" }}>
            <h3 style={{ fontSize: "14px", color: "#f0a0a0", marginBottom: "10px" }}>Vos das</h3>
            <TradeCardPicker cards={myOwnedCards} ownedMap={myCollection} selected={offerCards} onAdjust={adjustOffer} />
            <input
              type="number"
              min="0"
              max={coins}
              value={offerCoins}
              onChange={(e) => setOfferCoins(e.target.value)}
              placeholder="Monedas a ofrecer"
              style={{ width: "100%", marginTop: "10px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "8px", padding: "8px 12px", color: "#f4f1ea", fontSize: "13px", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: 1, minWidth: "280px" }}>
            <h3 style={{ fontSize: "14px", color: "#a8e6a1", marginBottom: "10px" }}>Vos pedís</h3>
            {friendOwnedCards.length === 0 ? (
              <p style={{ fontSize: "12px", color: "#8d87a8" }}>Tu amigo no tiene cartas para pedirle todavía.</p>
            ) : (
              <TradeCardPicker cards={friendOwnedCards} ownedMap={friendProfile.collection || {}} selected={requestCards} onAdjust={adjustRequest} />
            )}
            <input
              type="number"
              min="0"
              value={requestCoins}
              onChange={(e) => setRequestCoins(e.target.value)}
              placeholder="Monedas a pedir"
              style={{ width: "100%", marginTop: "10px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "8px", padding: "8px 12px", color: "#f4f1ea", fontSize: "13px", boxSizing: "border-box" }}
            />
          </div>
        </div>
      )}

      {status && (
        <p style={{ fontSize: "13px", color: status.ok ? "#a8e6a1" : "#f0a0a0", marginTop: "16px" }}>{status.message}</p>
      )}

      {friendProfile && (
        <button
          onClick={handleSend}
          disabled={sending}
          style={{
            marginTop: "16px",
            background: "#ffd95e",
            color: "#241b3d",
            border: "none",
            borderRadius: "999px",
            padding: "12px 32px",
            fontWeight: 700,
            fontSize: "15px",
            cursor: sending ? "not-allowed" : "pointer",
            opacity: sending ? 0.6 : 1,
          }}
        >
          {sending ? "Enviando..." : "Enviar propuesta"}
        </button>
      )}
    </div>
  );
}

function TradeCardPicker({ cards, ownedMap, selected, onAdjust }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(86px, 1fr))",
        gap: "10px",
        maxHeight: "320px",
        overflowY: "auto",
        padding: "4px",
      }}
    >
      {cards.map((card) => {
        const max = ownedMap[card.id] || 0;
        const qty = selected[card.id] || 0;
        const isSelected = qty > 0;
        return (
          <div
            key={card.id}
            onClick={() => onAdjust(card.id, 1, max)}
            style={{
              position: "relative",
              background: "rgba(255,255,255,0.04)",
              borderRadius: "8px",
              padding: "6px",
              textAlign: "center",
              cursor: qty >= max ? "default" : "pointer",
              border: isSelected ? `2px solid ${rarityColor(card.rarity)}` : "2px solid transparent",
              transition: "border-color 0.15s ease",
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
                    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="112"><rect width="80" height="112" fill="#352a55"/></svg>'
                  );
              }}
              style={{ width: "100%", borderRadius: "5px", marginBottom: "4px" }}
            />
            <div style={{ fontSize: "10px", fontWeight: 600, lineHeight: 1.15, marginBottom: "3px" }}>{card.name}</div>
            <div style={{ fontSize: "9px", color: "#8d87a8", marginBottom: "4px" }}>×{max} disponibles</div>

            {isSelected ? (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
              >
                <button
                  onClick={() => onAdjust(card.id, -1, max)}
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "5px",
                    border: "1px solid rgba(255,255,255,0.25)",
                    background: "rgba(255,255,255,0.08)",
                    color: "#f4f1ea",
                    fontSize: "12px",
                    cursor: "pointer",
                    lineHeight: 1,
                  }}
                >
                  −
                </button>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#ffd95e", minWidth: "12px" }}>{qty}</span>
                <button
                  onClick={() => onAdjust(card.id, 1, max)}
                  disabled={qty >= max}
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "5px",
                    border: "1px solid rgba(255,255,255,0.25)",
                    background: "rgba(255,255,255,0.08)",
                    color: qty >= max ? "#665f80" : "#f4f1ea",
                    fontSize: "12px",
                    cursor: qty >= max ? "not-allowed" : "pointer",
                    lineHeight: 1,
                  }}
                >
                  +
                </button>
              </div>
            ) : (
              <div style={{ fontSize: "10px", color: "#ffd95e", fontWeight: 600 }}>Tocar para elegir</div>
            )}
          </div>
        );
      })}
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

function CardZoomOverlay({ card, onClose }) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const cardRef = useRef(null);

  const handleMouseMove = useCallback((e) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);
    setTilt({ x: dy * -18, y: dx * 18 });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTilt({ x: 0, y: 0 });
  }, []);

  const shinyKeyframe = card.isShiny
    ? `@keyframes shinyZoomGlow {
        0%   { filter: hue-rotate(0deg) saturate(2) brightness(1.2); }
        100% { filter: hue-rotate(360deg) saturate(2) brightness(1.2); }
      }`
    : "";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,6,20,0.88)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
        cursor: "zoom-out",
      }}
    >
      {shinyKeyframe && <style>{shinyKeyframe}</style>}
      <div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "280px",
          perspective: "800px",
          cursor: "default",
        }}
      >
        <div
          style={{
            transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
            transition: "transform 0.08s ease-out",
            transformStyle: "preserve-3d",
          }}
        >
          <img
            src={card.images.large || card.images.small}
            alt={card.name}
            style={{
              width: "100%",
              borderRadius: "16px",
              boxShadow: card.isShiny
                ? "0 0 80px 20px rgba(168,240,255,0.6), 0 0 40px 10px rgba(255,120,255,0.4)"
                : card.rarity === "Rare Holo"
                ? "0 0 60px 14px rgba(255,217,94,0.55)"
                : card.rarity === "Rare"
                ? "0 0 40px 10px rgba(159,214,255,0.4)"
                : "0 20px 40px rgba(0,0,0,0.6)",
              animation: card.isShiny ? "shinyZoomGlow 2s linear infinite" : "none",
            }}
          />
        </div>
        <div style={{ marginTop: "16px", textAlign: "center", color: "#f4f1ea" }}>
          <div style={{ fontWeight: 700, fontSize: "18px" }}>
            {card.isShiny ? "✨ " : ""}{card.name}
          </div>
          <div style={{ fontSize: "13px", color: card.isShiny ? "#a8f0ff" : rarityColor(card.rarity), marginTop: "4px" }}>
            {card.isShiny ? "✨ Shiny" : card.rarity}
          </div>
          <div style={{ fontSize: "11px", color: "#8d87a8", marginTop: "12px" }}>
            Click fuera para cerrar · Mové el mouse sobre la carta
          </div>
        </div>
      </div>
    </div>
  );
}

function CollectionView({ cards, collection, ownedUnique, totalUnique, coins, onSell, onSellDuplicates }) {
  const completion = totalUnique ? Math.round((ownedUnique / totalUnique) * 100) : 0;
  const [zoomedCard, setZoomedCard] = useState(null);
  const [bulkRarities, setBulkRarities] = useState({ Common: true, Uncommon: false, Rare: false, "Rare Holo": false });
  const [bulkStatus, setBulkStatus] = useState(null);
  const [bulkSelling, setBulkSelling] = useState(false);

  const toggleRarity = (rarity) => setBulkRarities((prev) => ({ ...prev, [rarity]: !prev[rarity] }));
  const selectedRarities = Object.entries(bulkRarities).filter(([, v]) => v).map(([k]) => k);

  const handleBulkSell = async () => {
    if (selectedRarities.length === 0) { setBulkStatus({ ok: false, message: "Elegí al menos una rareza." }); return; }
    setBulkSelling(true);
    setBulkStatus(null);
    const result = await onSellDuplicates(selectedRarities);
    setBulkStatus(result);
    setBulkSelling(false);
  };

  const RARITIES = ["Common", "Uncommon", "Rare", "Rare Holo"];
  const rarityLabel = { Common: "Comunes", Uncommon: "Poco comunes", Rare: "Raras", "Rare Holo": "Raras Holo" };

  return (
    <div>
      {zoomedCard && <CardZoomOverlay card={zoomedCard} onClose={() => setZoomedCard(null)} />}

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

      {/* Panel vender duplicados */}
      <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: "12px", padding: "14px 16px", marginBottom: "20px" }}>
        <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "10px", color: "#c9c3e0" }}>
          Vender duplicados en bulk
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
          {RARITIES.map((r) => (
            <button
              key={r}
              onClick={() => toggleRarity(r)}
              style={{
                background: bulkRarities[r] ? "rgba(255,217,94,0.2)" : "rgba(255,255,255,0.05)",
                color: bulkRarities[r] ? "#ffd95e" : "#8d87a8",
                border: `1px solid ${bulkRarities[r] ? "rgba(255,217,94,0.5)" : "rgba(255,255,255,0.12)"}`,
                borderRadius: "999px",
                padding: "5px 14px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {rarityLabel[r]}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={handleBulkSell}
            disabled={bulkSelling}
            style={{
              background: "#ffd95e",
              color: "#241b3d",
              border: "none",
              borderRadius: "999px",
              padding: "8px 20px",
              fontSize: "13px",
              fontWeight: 700,
              cursor: bulkSelling ? "not-allowed" : "pointer",
              opacity: bulkSelling ? 0.6 : 1,
            }}
          >
            {bulkSelling ? "Vendiendo..." : "Vender duplicados"}
          </button>
          {bulkStatus && (
            <span style={{ fontSize: "12px", color: bulkStatus.ok ? "#a8e6a1" : "#f0a0a0" }}>
              {bulkStatus.message}
            </span>
          )}
        </div>
      </div>

      <p style={{ color: "#8d87a8", fontSize: "12px", marginBottom: "18px" }}>
        Tocá una carta para verla en grande. Podés vender copias extra con el botón "Vender".
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
                background: card.isShiny && owned ? "rgba(168,240,255,0.07)" : "rgba(255,255,255,0.04)",
                borderRadius: "10px",
                padding: "8px",
                textAlign: "center",
                opacity: owned ? 1 : 0.28,
                border: owned
                  ? card.isShiny
                    ? "1px solid rgba(168,240,255,0.5)"
                    : `1px solid ${rarityColor(card.rarity)}55`
                  : "1px solid transparent",
                cursor: owned ? "pointer" : "default",
              }}
              onClick={() => owned && setZoomedCard(card)}
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
                  filter: owned
                    ? card.isShiny
                      ? "saturate(1.6) brightness(1.1)"
                      : "none"
                    : "grayscale(1)",
                  marginBottom: "6px",
                }}
              />
              <div style={{ fontSize: "11px", fontWeight: 600, lineHeight: 1.2 }}>
                {card.isShiny ? "✨ " : ""}{card.name}
              </div>
              {owned > 1 && (
                <div style={{ fontSize: "11px", color: "#ffd95e", fontWeight: 700, marginTop: "2px" }}>
                  ×{owned}
                </div>
              )}
              {owned > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSell(card.id); }}
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
  const [stage, setStage] = useState("flash");
  const isBig = card.rarity === "Rare Holo" || card.rarity === "Rare" || card.isShiny;
  const particleColor = card.isShiny ? "#a8f0ff" : particleColorFor(card.rarity);

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

  const shinyKeyframe = card.isShiny
    ? `@keyframes shinyGlow-${revealKey} {
        0%   { filter: hue-rotate(0deg) saturate(1.8) brightness(1.15); }
        25%  { filter: hue-rotate(90deg) saturate(2.2) brightness(1.25); }
        50%  { filter: hue-rotate(180deg) saturate(2) brightness(1.2); }
        75%  { filter: hue-rotate(270deg) saturate(2.2) brightness(1.25); }
        100% { filter: hue-rotate(360deg) saturate(1.8) brightness(1.15); }
      }`
    : "";

  return (
    <div style={{ position: "relative", width: "240px", textAlign: "center" }}>
      {card.isShiny && shinyKeyframe && (
        <style>{shinyKeyframe}</style>
      )}
      <FlashOverlay
        active={stage === "flash"}
        color={card.isShiny ? "#a8f0ff" : particleColor}
        intensity={isBig ? 0.85 : 0.35}
      />
      {stage !== "flash" && (
        <ParticleBurst
          seed={revealKey}
          count={card.isShiny ? 40 : particleCountFor(card.rarity)}
          color={particleColor}
        />
      )}

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
            boxShadow: card.isShiny
              ? "0 0 60px 16px rgba(168,240,255,0.7), 0 0 30px 8px rgba(255,120,255,0.4)"
              : card.rarity === "Rare Holo"
              ? "0 0 50px 10px rgba(255,217,94,0.55)"
              : card.rarity === "Rare"
              ? "0 0 30px 6px rgba(159,214,255,0.4)"
              : "0 8px 24px rgba(0,0,0,0.5)",
            animation: card.isShiny && stage === "settled"
              ? `shinyGlow-${revealKey} 2s linear infinite`
              : "none",
          }}
        />
        <div style={{ marginTop: "14px", color: "#f4f1ea", fontWeight: 700, fontSize: "17px" }}>{card.name}</div>
        <div style={{ marginTop: "2px", fontSize: "13px", fontWeight: 600, color: card.isShiny ? "#a8f0ff" : rarityColor(card.rarity) }}>
          {card.isShiny ? "✨ Shiny" : card.rarity}
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

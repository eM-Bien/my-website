'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import s from './TreeScene.module.css';

/**
 * Drzewo w three.js, kamera na torze sterowanym scrollem.
 *
 * Tor jest w KEYS – jedna tabela, którą się stroi. Nie rozrzucaj tych liczb
 * po kodzie.
 *
 * Bez GSAP-a: pętla rAF i tak chodzi co klatkę, więc progress scrolla liczy
 * się z getBoundingClientRect. ScrollTrigger nic by tu nie dodał poza
 * kolejną zależnością.
 *
 * Model jest wymienny – scena nie wie nic o tym, skąd pochodzi tree.glb.
 * Podmienisz plik na lepszy model i nic tutaj nie trzeba ruszać, o ile pivot
 * siedzi u podstawy pnia, a drzewo rośnie w +Y.
 */

type Key = {
  at: number;      // progress scrolla 0..1
  angle: number;   // kąt orbity w radianach
  radius: number;  // odległość kamery od osi drzewa (× wysokość drzewa)
  height: number;  // wysokość kamery (× wysokość drzewa)
  look: number;    // punkt patrzenia (× wysokość drzewa)
  shiftX: number;  // przesunięcie drzewa w kadrze: 0 = środek, 1 = w prawo
};

const KEYS: Key[] = [
  { at: 0.0,  angle: 0,              radius: 2.3,  height: 0.58, look: 0.42, shiftX: 0 },
  { at: 0.30, angle: Math.PI,        radius: 1.55, height: 0.56, look: 0.44, shiftX: 0 },
  { at: 0.60, angle: Math.PI * 2,    radius: 1.40, height: 0.50, look: 0.42, shiftX: 0 },
  // dojazd i przekadrowanie: korona ucieka w prawo, lewa strona zostaje pusta
  { at: 1.0,  angle: Math.PI * 2.25, radius: 0.80, height: 0.82, look: 0.86, shiftX: 0.72 },
];

// Korona: kwiaty sadzone w kodzie na wierzchołkach gałęzi modelu.
const BLOSSOMS   = 42000;   // ile kart (2 trójkąty każda, jeden draw call)
const PETAL_SIZE = 0.028;   // bok karty × wysokość drzewa
const BLOSSOM_FROM = 0.34;  // od jakiej wysokości drzewa zaczyna się korona
// Blask za koroną: miękka plama za drzewem (od strony przeciwnej do kamery),
// płatki zasłaniają jej środek i zostaje obwódka. Odcina drzewo od gór,
// chmur i księżyca, które są w tej samej palecie.
const CROWN_GLOW = 1.1;     // siła
const CROWN_GLOW_SIZE = 1.6;   // średnica × szerokość korony
// Kora: mnożnik na teksturze (1 = jak w modelu). Domyślna jest jasnoszara
// i przy różowej koronie wygląda wypłowiale.
const BARK_DARKEN = 0.42;
// Wiatr: amplituda kołysania × wysokość drzewa. 0 = korona stoi.
const WIND = 0.014;
// Światło jedzie z kamerą, nie stoi w scenie: przy pełnej orbicie stałe
// źródło raz oświetla przód, raz tył i drzewo w połowie drogi robi się
// płaskie. Te dwie liczby to odsunięcie na bok i w górę, w promieniach orbity.
const LIGHT_SIDE = 0.9;
const LIGHT_UP = 0.55;
// Kontrast korony: ile zostaje w cieniu i ile dokłada strona oświetlona.
const SHADE_MIN = 0.3;
const SHADE_GAIN = 1.15;
// Podłoże: miękka poświata pod koroną i opadłe płatki. Bez tego drzewo
// wisi w próżni — pień kończy się w połowie kadru i nie ma się o co oprzeć.
const GROUND_PETALS = 1200;
const FLOAT_PETALS = 700;   // płatki dryfujące po wodzie
const FLOAT_DRIFT = 0.012;  // zasięg dryfu × wysokość drzewa
// Gwiazdy: kopuła daleko za drzewem, poniżej horyzontu chowa je woda.
const STARS = 900;
const STAR_SIZE = 1.5;      // mnożnik wielkości
const STAR_TWINKLE = 2.6;   // tempo migotania
// Świecące motyle: krążą wokół korony, wchodzą w trakcie scrolla.
const BUTTERFLIES = 14;
const BUTTERFLY_FROM = 0.03;   // progress, od którego się pojawiają
const BUTTERFLY_SIZE = 0.085;  // rozpiętość × wysokość drzewa
const MOUND_H = 0.17;       // wysokość pagórka × wysokość drzewa
const MOUND_R = 0.44;       // promień pagórka × rozmiar drzewa
// Szczyt fizycznie ten sam co przy promieniu 0.30 (0.38 × 0.30 = 0.26 × 0.44);
// zmienia się tylko długość zbocza — łagodnie wchodzi w wodę.
const MOUND_TOP = 0.26;     // jaka część promienia jest płaskim szczytem
const MOUND_STRETCH = 1.0;  // rozciągnięcie wyspy wzdłuż X, 1 = koło
// Woda: poziom liczony od szczytu pagórka, więc zmiana MOUND_H nie zatapia
// wyspy. Rozdzielczość odbicia to osobny render sceny co klatkę — 512 px
// wystarcza, bo i tak rozmywają je zmarszczki.
const WATER_LEVEL = 0.30;   // ile pagórka zostaje nad wodą liczone od dołu
const WATER_RES = 512;
// Góry: walec z teksturą dookoła sceny, u podstawy schowany za wodą.
const MOUNTAIN_H = 3.0;     // wysokość × wysokość drzewa
const MOUNTAIN_REPEAT = 7;  // ile lustrzanych powtórzeń dookoła
// Chmury: drugi walec za górami, kształt liczony szumem w shaderze.
const CLOUD_H = 3.2;        // wysokość × wysokość drzewa
const CLOUD_COVER = 0.42;   // próg szumu: niżej = więcej chmur
const CLOUD_SOFT = 0.22;    // miękkość krawędzi
const CLOUD_DRIFT = 0.012;  // obrót dookoła, rad/s
const CLOUD_EVOLVE = 0.03;  // jak szybko zmieniają kształt
const CLOUD_OPACITY = 0.85;
// Księżyc: wielka różowa tarcza za górami, świeci na chmury i na wodę.
// Księżyc jedzie z kamerą (zawsze za drzewem), a w kadrze wędruje
// z prawej na lewą w miarę scrolla. Kąty w radianach od osi patrzenia:
// ujemne = prawa strona kadru, dodatnie = lewa.
const MOON_FROM = -0.3;
const MOON_TO = 0.9;
// Pod koniec scrolla księżyc gaśnie – zostaje kadr z koroną i tekstem.
const MOON_FADE_FROM = 0.7;    // progress, od którego zaczyna znikać
const MOON_FADE_SPAN = 0.18;
const MOON_AZIMUTH = Math.PI - 0.5;  // pozycja startowa (nadpisywana w pętli)
const MOON_SIZE = 0.34;        // promień tarczy = MOON_SIZE × wysokość drzewa × 5
const MOON_ELEV = 0.55;        // ile tarczy wystaje ponad szczyty na starcie (0..1)
const MOON_RISE = 0.5;         // o ile średnic wznosi się do końca scrolla
const MOON_RISE_SPAN = 0.7;    // w jakiej części scrolla trwa wznoszenie
const MOON_COLOR = 0xff6b86;
const MOON_GLOW = 0.5;         // siła poświaty wokół tarczy (obrazek ma własną)
const MOUND_BUMP = 0.34;    // ile nierówności (0 = gładka kopuła)

// Tytuł wyłaniający się z wody na starcie; znika przy pierwszym scrollu.
const TITLE_OUT = 0.10;        // progress, przy którym tytuł jest już schowany

/**
 * Tytuł jako obiekt w scenie, nie element DOM.
 *
 * Tylko tak pień może go naprawdę zasłonić: napis stoi za drzewem, nad taflą,
 * a bufor głębokości robi resztę – z korą, gałęziami i płatkami. DOM leżał
 * nad canvasem i żadna maska nie oddawała sylwetki. Bonus: Reflector renderuje
 * scenę drugi raz od spodu, więc odbicie w wodzie wychodzi samo.
 */
const TITLE = {
  text: 'portfolio',
  width: 3.1,       // szerokość napisu (× rozmiar drzewa); rośnie z trackingiem, bo inaczej litery maleją
  dist: 0.42,       // jak daleko ZA osią drzewa, w stronę od kamery (× rozmiar drzewa)
  lift: -0.4,       // dolna krawędź względem tafli (× wysokość napisu); ujemne = w wodzie
  rise: 2200,       // ms wynurzania na starcie
  color: '#ffffff',
  glow: 'rgba(255, 255, 255, 0.45)',
  font: '--font-title',   // zmienna CSS z layout.tsx; zapas: --font-display
  weight: 400,
  tracking: 0.18,   // światło międzyliterowe w em
};

/**
 * Warstwy kamery dla trybu fluid. Napis nie może przejść przez postprocessing
 * (smuga by go rozmazała), więc rysujemy go osobno, NA gotowym kadrze – ale
 * wtedy pień musi go zasłaniać na nowo, bo bufor głębokości kadru już nie
 * istnieje. Stąd osobny, tani przebieg samych zasłaniaczy do głębi.
 */
const LAYER_OCCLUDER = 1;   // pień, gałęzie, pagórek: tylko głębia, bez koloru
const LAYER_TITLE = 2;      // napis: rysowany po composite

/**
 * Napis wypalony na canvasie 2D. Font bierzemy ze zmiennej CSS, bo next/font
 * nadaje mu zahaszowaną nazwę rodziny – "Cormorant Garamond" w ctx.font
 * trafiłoby w pustkę i dostalibyśmy Georgię.
 */
function titleTexture(text: string): { tex: THREE.CanvasTexture; aspect: number } {
  const PX = 256;
  const css = getComputedStyle(document.documentElement);
  const family =
    css.getPropertyValue(TITLE.font).trim() ||
    css.getPropertyValue('--font-display').trim() ||
    'Georgia, serif';
  const font = `${TITLE.weight} ${PX}px ${family}`;
  const upper = text.toUpperCase();

  const c = document.createElement('canvas');
  const ctx = c.getContext('2d') as CanvasRenderingContext2D & { letterSpacing?: string };
  const setFont = () => {
    ctx.font = font;
    // starsze Firefoksy nie znają letterSpacing – wtedy po prostu bez trackingu
    ctx.letterSpacing = `${PX * TITLE.tracking}px`;
  };

  setFont();
  const w = Math.ceil(ctx.measureText(upper).width + PX * 0.8);
  const h = Math.ceil(PX * 1.5);
  c.width = w;
  c.height = h;
  setFont();   // zmiana rozmiaru canvasu zeruje cały stan kontekstu

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = TITLE.glow;
  ctx.shadowBlur = PX * 0.3;
  ctx.fillStyle = TITLE.color;
  // letterSpacing dokłada odstęp także ZA ostatnią literą, więc textAlign
  // center wyśrodkowuje napis razem z tym pustym ogonem – kompensujemy.
  const cx = w / 2 + (PX * TITLE.tracking) / 2;
  ctx.fillText(upper, cx, h / 2);
  ctx.fillText(upper, cx, h / 2);   // drugi raz – poświata się dokłada

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;   // napis stoi pod kątem do kamery, bez tego się rozmywa
  return { tex, aspect: w / h };
}

/**
 * Rozciągnięcie drzewa w pionie. Celowo NIE wchodzi do treeHeight ani fitSize:
 * kamera, woda, pagórek i tytuł są liczone względem nich, więc gdyby weszło,
 * kamera odjechałaby proporcjonalnie i drzewo w kadrze wyglądałoby tak samo.
 * Skalujemy sam model, a to, co czyta jego geometrię (kwiaty, światełka,
 * środek korony), dostaje ten sam mnożnik.
 */
const TREE_STRETCH = 1.12;

/**
 * Podpisy przy drzewie, sterowane scrollem. Każdy ma okno [from, to] w
 * progressie: wjeżdża przez CAPTION_FADE na początku i gaśnie przez
 * CAPTION_FADE przed końcem. Treść siedzi w JSX (żeby dało się dać markup
 * i kiedyś tłumaczenie) – tu tylko kiedy i po której stronie.
 *
 * Pierwszy zaczyna zaraz po TITLE_OUT (tytuł już pod wodą), ostatni kończy
 * przed COPY_FROM (blok końcowy po przekadrowaniu).
 */
const CAPTION_FADE = 0.05;
const CAPTIONS = [
  { from: 0.12, to: 0.36 },   // lewa: powitanie
  { from: 0.40, to: 0.64 },   // prawa: zaproszenie
];

const COPY_FROM = 0.72;   // od którego progressu wchodzi tekst
const COPY_SPAN = 0.18;

/**
 * Smuga za kursorem – uproszczona wersja efektu z leoparpeix.com.
 *
 * Tam siedzi pełna symulacja Naviera-Stokesa (adwekcja → dywergencja →
 * iteracje ciśnienia). Tutaj jest flowmap: mysz maluje plamę prędkości
 * w jedną teksturę, tekstura wygasa co klatkę, a jej wartości przesuwają
 * UV gotowego kadru. Jeden pass zamiast dwudziestu kilku.
 *
 * Czego flowmap NIE ma: wirów i zawijasów. Płyn ma je stąd, że pole
 * prędkości oddziałuje samo na siebie. Tu smuga tylko płynie i gaśnie.
 */
const FLUID = {
  size: 256,          // rozdzielczość pola przepływu (i tak jest rozmyte – nie musi być duża)
  dissipation: 0.94,  // ile smugi zostaje z poprzedniej klatki: 0.9 = krótka, 0.98 = leniwa
  falloff: 0.22,      // promień plamy malowanej przez kursor, w UV
  // Uwaga na kumulację: pole to flow = flow*dissipation + nowa plama, więc
  // przy ciągłym ruchu ustala się na ok. 1/(1-dissipation) = 17x tego, co
  // wstrzykujemy. Pierwsza wersja miała gain 14, czyli realnie ~230x – obraz
  // wyjeżdżał pół ekranu w bok i nie dało się tego odczytać jako smugi.
  gain: 2.5,          // ile prędkości myszy wchodzi w pole
  clamp: 1.2,         // twardy sufit na długość wektora – bez tego pole rośnie bez końca
  strength: 0.16,     // jak mocno pole przesuwa obraz
  split: 0.8,         // rozjechanie kanałów RGB na krawędziach smugi
  ink: 0.5,           // rozjaśnienie wzdłuż smugi (patrz komentarz w COMPOSITE_FRAG)
};

/** Wspólny vertex shader dla wszystkich passów pełnoekranowych. */
const QUAD_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

/** Ping-pong: poprzednia klatka razy dissipation + nowa plama pod kursorem. */
const FLOW_FRAG = `
  uniform sampler2D tPrev;
  uniform vec2 uMouse;
  uniform vec2 uVelocity;
  uniform float uAspect;
  uniform float uFalloff;
  uniform float uDissipation;
  uniform float uClamp;
  varying vec2 vUv;
  void main() {
    vec2 flow = texture2D(tPrev, vUv).xy * uDissipation;
    vec2 d = vUv - uMouse;
    d.x *= uAspect;                                   // bez tego plama jest owalna
    float blob = smoothstep(uFalloff, 0.0, length(d));
    flow += uVelocity * blob;
    // sufit na długość wektora, nie na składowe – clamp per-oś wykrzywiałby
    // kierunek smugi po skosie
    float len = length(flow);
    if (len > uClamp) flow *= uClamp / len;
    gl_FragColor = vec4(flow, 0.0, 1.0);
  }`;

/** Kadr sceny próbkowany z UV przesuniętym o pole przepływu. */
const COMPOSITE_FRAG = `
  uniform sampler2D tScene;
  uniform sampler2D tFlow;
  uniform float uStrength;
  uniform float uSplit;
  uniform float uInk;
  varying vec2 vUv;
  void main() {
    vec2 flow = texture2D(tFlow, vUv).xy;
    vec2 off = flow * uStrength;
    // kanały rozjeżdżają się tym mocniej, im szybciej szedł kursor –
    // to daje atramentowy refleks na krawędzi smugi
    float k = length(flow) * uSplit;
    float r = texture2D(tScene, vUv + off * (1.0 + k)).r;
    vec4  g = texture2D(tScene, vUv + off);
    float b = texture2D(tScene, vUv + off * (1.0 - k)).b;
    vec3 col = vec3(r, g.g, b);

    // Samo przesuwanie UV jest tu prawie niewidoczne: niebo to gładki gradient
    // PIONOWY, więc przesunięcie w poziomie nie zmienia ani jednego piksela.
    // Smuga musi więc także rozjaśniać, nie tylko wyginać.
    col += vec3(0.34, 0.20, 0.46) * smoothstep(0.0, 1.0, length(flow)) * uInk;

    gl_FragColor = vec4(col, g.a);
  }`;

/**
 * Niebo przeniesione z CSS-a do sceny.
 *
 * Musi tu być: postprocessing zniekształca wyłącznie to, co jest w WebGL.
 * Gradient na .section leży POD canvasem, shader go nie widzi – zostałby
 * nieruchomy, a falowałoby samo drzewo. Liczby 420/100 to wysokość sekcji
 * i okna z TreeScene.module.css; zmienisz tam – zmień i tutaj.
 */
/**
 * Przystanki nieba. Kolory NIE są tu wpisane – czytamy je ze zmiennych CSS,
 * żeby paleta miała jedno źródło prawdy w globals.scss. Fallback jest na
 * wypadek literówki w nazwie zmiennej: lepiej pokazać stary kolor niż czerń.
 *
 * Pozycje (`at`) odpowiadają przystankom linear-gradient w
 * TreeScene.module.css – tego akurat nie da się odczytać z CSS-u sensownie,
 * więc przy zmianie gradientu trzeba poprawić oba miejsca.
 */
const SKY = [
  { css: '--night', at: 0.0, fallback: '#050414' },
  { css: '--bg-dark', at: 0.2, fallback: '#0A084A' },
  { css: '--bg-blue-dark', at: 0.46, fallback: '#06388B' },
  { css: '--purple-dark', at: 0.68, fallback: '#3E0C66' },
  { css: '--purple', at: 0.86, fallback: '#642690' },
  { css: '--pink-purple', at: 1.0, fallback: '#9A5FB7' },
];

/**
 * Hex → 0..1, ręcznie. THREE.Color odpada: jego konstruktor przepuszcza
 * kolor przez ColorManagement i zwraca wartości liniowe, a shader nieba
 * pisze prosto do targetu w sRGB. Wyszłoby wyraźnie za ciemne.
 */
function cssColor(name: string, fallback: string): THREE.Vector3 {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(raw || fallback);
  const n = parseInt(m ? m[1] : fallback.slice(1), 16);
  return new THREE.Vector3(
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255
  );
}

const SKY_FRAG = `
  uniform vec3 uSky[6];
  uniform float uStop[6];
  uniform float uScroll;
  uniform float uViewport;   // jaka część gradientu mieści się w oknie
  varying vec2 vUv;
  void main() {
    // Wycinek gradientu widoczny przez sticky stage. Liczony z realnej
    // wysokości sekcji, więc zmiana 420vh w CSS nie rozjeżdża nieba.
    float t = uScroll * (1.0 - uViewport) + (1.0 - vUv.y) * uViewport;
    vec3 c = uSky[0];
    for (int i = 1; i < 6; i++) {
      c = mix(c, uSky[i], smoothstep(uStop[i - 1], uStop[i], t));
    }
    gl_FragColor = vec4(c, 1.0);
  }`;

function sampleKeys(p: number) {
  let a = KEYS[0];
  let b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (p >= KEYS[i].at && p <= KEYS[i + 1].at) {
      a = KEYS[i];
      b = KEYS[i + 1];
      break;
    }
  }
  const span = b.at - a.at || 1;
  const t = Math.min(Math.max((p - a.at) / span, 0), 1);
  // smoothstep – liniowa interpolacja widocznie szarpie na granicach kluczy
  const e = t * t * (3 - 2 * t);
  const mix = (x: number, y: number) => x + (y - x) * e;
  return {
    angle: mix(a.angle, b.angle),
    radius: mix(a.radius, b.radius),
    height: mix(a.height, b.height),
    look: mix(a.look, b.look),
    shiftX: mix(a.shiftX, b.shiftX),
  };
}

/** Miękka kropka jako tekstura – to ona robi „świecenie", nie bloom. */
function glowTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  // ciepłe, pod różowy księżyc – niebieskie punkty gryzły się z resztą
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,205,230,0.85)');
  g.addColorStop(0.55, 'rgba(255,110,170,0.28)');
  g.addColorStop(1.0, 'rgba(255,60,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


/** Czteroramienna gwiazdka: jasny rdzeń i dwa cienkie, długie promienie. */
function starTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';
  const core = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.18);
  core.addColorStop(0.0, 'rgba(255,255,255,1)');
  core.addColorStop(0.35, 'rgba(200,215,255,0.8)');
  core.addColorStop(1.0, 'rgba(120,150,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, S, S);
  // promienie: wąskie w środku, gasnące ku końcom
  for (const rot of [0, Math.PI / 2]) {
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(rot);
    const g = ctx.createLinearGradient(-S / 2, 0, S / 2, 0);
    g.addColorStop(0.0, 'rgba(160,190,255,0)');
    g.addColorStop(0.5, 'rgba(240,245,255,0.95)');
    g.addColorStop(1.0, 'rgba(160,190,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-S / 2, 0);
    ctx.quadraticCurveTo(0, -S * 0.045, S / 2, 0);
    ctx.quadraticCurveTo(0, S * 0.045, -S / 2, 0);
    ctx.fill();
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


/** Motyl z dwóch par skrzydeł, miękkie krawędzie – pod additive świeci sam. */
function butterflyTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';
  const wing = (cx: number, cy: number, rx: number, ry: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.22)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const side of [-1, 1]) {
    wing(S / 2 + side * 30, 50, 27, 23);   // przednie
    wing(S / 2 + side * 21, 84, 18, 17);   // tylne
  }
  const body = ctx.createLinearGradient(0, 28, 0, 104);
  body.addColorStop(0, 'rgba(255,255,255,0)');
  body.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  body.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = body;
  ctx.fillRect(S / 2 - 2, 28, 4, 76);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


export default function TreeScene({ fluid = false }: { fluid?: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const copyRef = useRef<HTMLDivElement | null>(null);
  const captionRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const el = hostRef.current;
    const sectionEl = sectionRef.current;
    const copyEl = copyRef.current;
    if (!el || !sectionEl) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 200);

    // Ambient trzymany nisko: przy 2.2 kierunek światła ginął i obrót
    // wyglądał płasko niezależnie od pozycji lamp.
    scene.add(new THREE.AmbientLight(0x93b4e6, 1.1));
    // Pozycje ustawia pętla — obie lampy wiszą na kamerze.
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff9a55, 0.8);
    scene.add(rim);
    const UP = new THREE.Vector3(0, 1, 0);
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();

    const root = new THREE.Group();
    scene.add(root);

    let treeHeight = 10;
    let fitSize = 10;   // większy z wymiarów: szerokość vs wysokość
    let points: THREE.Points | null = null;
    let titleMesh: THREE.Mesh | null = null;
    let titleMat: THREE.ShaderMaterial | null = null;
    let titleTex: THREE.Texture | null = null;
    let waterMat: THREE.ShaderMaterial | null = null;
    let water: Reflector | null = null;
    let moonBillboards: THREE.Object3D[] = [];
    let moonBaseY = 0;
    let moonRise = 0;
    let moonDist = 0;
    let crownGlow: THREE.Mesh | null = null;
    const crownCenter = new THREE.Vector3();
    const moonMats: { disc?: THREE.MeshBasicMaterial; halo?: THREE.ShaderMaterial } = {};
    let cloudMat: THREE.ShaderMaterial | null = null;

    let disposed = false;
    let raf = 0;
    let smooth = 0;

    const tex = glowTexture();

    // ——— smuga za kursorem ———
    // Jeden quad na wszystkie passy pełnoekranowe: materiał podmieniamy
    // przed każdym renderem, zamiast trzymać trzy osobne sceny.
    let sceneRT: THREE.WebGLRenderTarget | null = null;
    let flowRead: THREE.WebGLRenderTarget | null = null;
    let flowWrite: THREE.WebGLRenderTarget | null = null;
    let quad: THREE.Mesh | null = null;
    let quadScene: THREE.Scene | null = null;
    let quadCam: THREE.OrthographicCamera | null = null;
    let skyMat: THREE.ShaderMaterial | null = null;
    let flowMat: THREE.ShaderMaterial | null = null;
    let compMat: THREE.ShaderMaterial | null = null;

    // Tylko głębia: kolor nie zapisuje się, więc kadr pod spodem zostaje.
    const depthOnlyMat = new THREE.MeshBasicMaterial({ colorWrite: false });

    const mouse = new THREE.Vector2(0.5, 0.5);
    const mouseVel = new THREE.Vector2();
    let hasMouse = false;
    const onPointerMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height;   // WebGL ma Y do góry
      if (hasMouse) mouseVel.set(x - mouse.x, y - mouse.y);
      mouse.set(x, y);
      hasMouse = true;
    };

    // Jaka część gradientu sekcji mieści się naraz w oknie. Przy 420vh
    // sekcji i 100vh okna to 1/4.2 – ale czytamy to z DOM-u, żeby nie
    // powielać liczb z TreeScene.module.css (a na mobile sekcja ma 320vh).
    const viewportFraction = () => {
      const secH = sectionEl.getBoundingClientRect().height;
      return secH > 0 ? Math.min(window.innerHeight / secH, 1) : 1;
    };

    if (fluid) {
      const w = el.clientWidth;
      const h = el.clientHeight;

      // Kadr sceny: zwykłe 8 bitów wystarczy. colorSpace = sRGB, żeby three
      // zrobiło konwersję już przy renderze do targetu.
      sceneRT = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
      });
      sceneRT.texture.colorSpace = THREE.SRGBColorSpace;

      // Pole przepływu MUSI być zmiennoprzecinkowe – prędkość bywa ujemna,
      // a w zwykłym RGBA8 nie ma jak zapisać minusa.
      const flowOpts = {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
      };
      flowRead = new THREE.WebGLRenderTarget(FLUID.size, FLUID.size, flowOpts);
      flowWrite = new THREE.WebGLRenderTarget(FLUID.size, FLUID.size, flowOpts);

      skyMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          uSky: { value: SKY.map((k) => cssColor(k.css, k.fallback)) },
          uStop: { value: SKY.map((k) => k.at) },
          uScroll: { value: 0 },
          uViewport: { value: viewportFraction() },
        },
        depthTest: false,
        depthWrite: false,
      });
      flowMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: FLOW_FRAG,
        uniforms: {
          tPrev: { value: null },
          uMouse: { value: mouse },
          uVelocity: { value: new THREE.Vector2() },
          uAspect: { value: w / h },
          uFalloff: { value: FLUID.falloff },
          uDissipation: { value: FLUID.dissipation },
          uClamp: { value: FLUID.clamp },
        },
        depthTest: false,
        depthWrite: false,
      });
      compMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: COMPOSITE_FRAG,
        uniforms: {
          tScene: { value: sceneRT.texture },
          tFlow: { value: null },
          uStrength: { value: FLUID.strength },
          uSplit: { value: FLUID.split },
          uInk: { value: FLUID.ink },
        },
        depthTest: false,
        depthWrite: false,
      });

      quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat);
      // Vertex shader sam ustawia gl_Position, więc culling po bounding
      // sphere nie ma tu sensu i mógłby wyciąć quad zupełnie bez powodu.
      quad.frustumCulled = false;
      quadScene = new THREE.Scene();
      quadScene.add(quad);

      // Świeży render target ma nieokreśloną zawartość, a pierwsza klatka
      // od razu z niego czyta – na części sterowników byłyby śmieci.
      for (const rt of [flowRead, flowWrite]) {
        renderer.setRenderTarget(rt);
        renderer.clear();
      }
      renderer.setRenderTarget(null);

      window.addEventListener('pointermove', onPointerMove);
    }
    const starTex = starTexture();
    const flyTex = butterflyTexture();
    const uFly = { value: 0 };   // widoczność motyli, sterowana scrollem
    // Jeden uniform czasu dla kwiatów i świateł — inaczej rozjeżdżają się
    // fazy i światełka zostają w miejscu, z którego płatek już odjechał.
    const uTime = { value: 0 };
    // Kierunek klucza w świecie – kwiaty cieniują się po nim same.
    const uLight = { value: new THREE.Vector3(-1, 0.4, 0).normalize() };

    // Model jest skompresowany Draco – bez tego dekodera GLTFLoader rzuca
    // "no DRACOLoader instance provided" i scena zostaje pusta. Dekoder
    // (252 kB) leży w public/draco i ładuje się dopiero przy wczytywaniu.
    const gltfLoader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    gltfLoader.setDRACOLoader(draco);

    Promise.all([
      gltfLoader.loadAsync('/scene/tree.glb'),
      fetch('/scene/tips.json').then((r) => r.json()),
    ])
      .then(([gltf, data]: [{ scene: THREE.Group }, { tips: number[][]; height: number }]) => {
        if (disposed) return;

        gltf.scene.traverse((o: THREE.Object3D) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mm of mats) {
            const std = mm as THREE.MeshStandardMaterial;
            if (!std) continue;
            // Płatki przychodzą z Blendera jako alpha BLEND. Przezroczystość
            // w koronie wymaga sortowania per trójkąt, którego nie ma – płatki
            // znikają za sobą. alphaTest daje ostrą maskę i zero sortowania.
            //
            // Decyduje WYŁĄCZNIE tryb alfy z glTF, nie obecność tekstury.
            // Tekstura pnia to łatka na szew: 91% jej pikseli ma alfę 0,
            // więc alphaTest na materiale OPAQUE wycinał cały pień.
            if (std.transparent || std.alphaTest > 0) {
              std.transparent = false;
              std.alphaTest = 0.5;
            } else {
              std.alphaTest = 0;
            }
            std.side = THREE.DoubleSide;   // płatki to płaskie karty
            std.envMapIntensity = 0.4;
            if (/trunk|bark|branch/i.test(std.name)) {
              std.color.multiplyScalar(BARK_DARKEN);
            }
          }
        });
        // Awaryjnie: gdyby pień znów przyszedł z łatką na szew zamiast kory
        // (91% pikseli tej tekstury jest przezroczystych, pod spodem czerń),
        // pożyczamy mu teksturę z gałęzi.
        {
          let bark: THREE.Texture | null = null;
          gltf.scene.traverse((o: THREE.Object3D) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const std = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
            if (/bark|branch/i.test(std.name) && std.map) bark = std.map;
          });
          if (bark) {
            gltf.scene.traverse((o: THREE.Object3D) => {
              const m = o as THREE.Mesh;
              if (!m.isMesh) return;
              const std = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
              if (/trunk/i.test(std.name) && /seam/i.test(std.map?.name || '')) {
                std.map = bark;
                std.needsUpdate = true;
              }
            });
          }
        }
        root.add(gltf.scene);
        treeHeight = data.height || 10;
        {
          const bb = new THREE.Box3().setFromObject(gltf.scene);
          const sz = bb.getSize(new THREE.Vector3());
          fitSize = Math.max(sz.y, Math.max(sz.x, sz.z) * 0.85);
        }
        // Dopiero teraz – box wyżej ma zostać nierozciągnięty, żeby kamera
        // nie odjechała. Skala wokół origin, więc podstawa pnia zostaje na 0.
        gltf.scene.scale.y = TREE_STRETCH;

        // ── kwiaty ─────────────────────────────────────────────────────
        // Korona z modelu to była ślepa uliczka: płatek ma tam ~3 cm przy
        // drzewie 7 m (dwa piksele w kadrze), więc żeby cokolwiek było
        // widać, trzeba ich milion — i tyle samo trójkątów w glb.
        // Zamiast tego sadzimy własne karty na wierzchołkach gałęzi:
        // jeden InstancedMesh, jeden draw call, gęstość i kolor do
        // wyklikania w stałych poniżej.
        {
          let petalMap: THREE.Texture | null = null;
          const spots: number[] = [];
          const hide: THREE.Mesh[] = [];

          gltf.scene.updateWorldMatrix(true, true);
          gltf.scene.traverse((o: THREE.Object3D) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const std = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
            if (/petal|canopy|blossom/i.test(std.name + m.name)) {
              if (std.map) petalMap = std.map;
              hide.push(m);                    // oryginalne płatki zastępujemy
              return;
            }
            if (/trunk/i.test(m.name)) return; // na pniu kwiaty nie rosną
            const pos = m.geometry.attributes.position;
            const v = new THREE.Vector3();
            for (let i = 0; i < pos.count; i++) {
              v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
              if (v.y > treeHeight * TREE_STRETCH * BLOSSOM_FROM) spots.push(v.x, v.y, v.z);
            }
          });
          // Gałęzie z pierwszej decymacji to iglice o proporcji 1:1400 —
          // sterczą poza koronę jak drzazgi. Mierzymy wydłużenie trójkątów
          // i chowamy siatki, które się rozjechały; na czystym modelu ta
          // reguła nigdy nie zadziała.
          gltf.scene.traverse((o: THREE.Object3D) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh || hide.includes(m) || /trunk/i.test(m.name)) return;
            const pos = m.geometry.attributes.position;
            const idx = m.geometry.index;
            const tris = idx ? idx.count / 3 : pos.count / 3;
            const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
            const ratios: number[] = [];
            const step = Math.max(1, Math.floor(tris / 200));
            for (let t = 0; t < tris; t += step) {
              const g = (i: number) => (idx ? idx.getX(t * 3 + i) : t * 3 + i);
              a.fromBufferAttribute(pos, g(0));
              b.fromBufferAttribute(pos, g(1));
              c.fromBufferAttribute(pos, g(2));
              const e = [a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)].sort((x, y) => x - y);
              ratios.push(e[2] / Math.max(e[0], 1e-6));
            }
            ratios.sort((x, y) => x - y);
            if (ratios.length && ratios[ratios.length >> 1] > 40) m.visible = false;
          });

          for (const m of hide) m.visible = false;
          // Do przebiegu głębi pod napisem. Płatki z modelu i tak są ukryte;
          // własne płatki (InstancedMesh) tu nie trafiają – z materiałem
          // zastępczym straciłyby alphaTest i zasłaniałyby jako pełne karty.
          gltf.scene.traverse((o: THREE.Object3D) => {
            const m = o as THREE.Mesh;
            if (m.isMesh && !hide.includes(m)) m.layers.enable(LAYER_OCCLUDER);
          });

          const n = spots.length / 3;
          if (n > 0) {
            const geo = new THREE.PlaneGeometry(1, 1);
            const mat = new THREE.MeshStandardMaterial({
              map: petalMap,
              color: 0xd8cff0,   // odbicie jasne – warstwa tafli i tak je tłumi
              roughness: 0.85,
              metalness: 0,
              // Tekstura płatka jest blada (średnio 176,144,144), a światło
              // w scenie zimne — bez podbicia korona wychodzi szarobura.
              emissive: new THREE.Color(0xff6fae),
              emissiveIntensity: 0.26,
              side: THREE.DoubleSide,
              alphaTest: 0.5,               // maska zamiast blendu: bez sortowania
              transparent: false,
            });
            // Kołysanie liczone w shaderze: 42 tys. macierzy przeliczanych
            // co klatkę na CPU zjadłoby więcej niż cała reszta sceny.
            mat.onBeforeCompile = (shader) => {
              shader.uniforms.uTime = uTime;
              shader.uniforms.uLight = uLight;
              shader.uniforms.uWind = { value: treeHeight * WIND };
              shader.uniforms.uH = { value: treeHeight };
              shader.vertexShader =
                'uniform float uTime;\nuniform float uWind;\nuniform float uH;\n' +
                'uniform vec3 uLight;\nvarying float vShade;\n' +
                `#define SHADE_MIN ${SHADE_MIN.toFixed(2)}\n#define SHADE_GAIN ${SHADE_GAIN.toFixed(2)}\n` +
                shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
                #ifdef USE_INSTANCING
                  vec3 iPos = instanceMatrix[3].xyz;
                  // offset wraca potem przez instanceMatrix, więc dzielimy
                  // przez skalę instancji – inaczej małe karty ledwo drgną
                  float iScale = max(length(instanceMatrix[0].xyz), 1e-4);
                  float ph = iPos.x * 0.7 + iPos.z * 0.9 + iPos.y * 0.3;
                  float g = smoothstep(0.15, 1.0, iPos.y / uH);
                  float sx = sin(uTime * 1.1 + ph) + 0.4 * sin(uTime * 2.3 + ph * 1.7);
                  float sz = cos(uTime * 0.9 + ph * 1.3);
                  transformed += vec3(sx, sx * 0.25, sz * 0.7) * (uWind * g / iScale);
                  // Karty mają losowy obrót, więc ich własne normalne dają
                  // szum zamiast cieniowania. Bierzemy kierunek od osi drzewa
                  // na zewnątrz – korona cieniuje się wtedy jak kula i przy
                  // obrocie widać, z której strony pada światło.
                  vec3 outward = normalize(vec3(iPos.x, (iPos.y - uH * 0.62) * 0.8, iPos.z));
                  vShade = SHADE_MIN + SHADE_GAIN * max(dot(outward, uLight), 0.0);
                #else
                  vShade = 1.0;
                #endif`);
              shader.fragmentShader = 'varying float vShade;\n' +
                shader.fragmentShader.replace('#include <map_fragment>',
                  '#include <map_fragment>\n  diffuseColor.rgb *= vShade;');
            };

            const inst = new THREE.InstancedMesh(geo, mat, BLOSSOMS);
            const dummy = new THREE.Object3D();
            const tint = new THREE.Color();
            const base = new THREE.Vector3();
            const size = treeHeight * PETAL_SIZE;
            for (let i = 0; i < BLOSSOMS; i++) {
              const k = ((Math.random() * n) | 0) * 3;
              base.set(spots[k], spots[k + 1], spots[k + 2]);
              // rozrzut wokół gałązki, żeby kwiaty nie leżały na siatce
              dummy.position.set(
                base.x + (Math.random() - 0.5) * size * 2.2,
                base.y + (Math.random() - 0.5) * size * 1.6,
                base.z + (Math.random() - 0.5) * size * 2.2
              );
              dummy.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
              );
              const sc = size * (0.65 + Math.random() * 0.8);
              dummy.scale.set(sc, sc, sc);
              dummy.updateMatrix();
              inst.setMatrixAt(i, dummy.matrix);
              // odrobina wariacji, inaczej korona wygląda jak jednolita plama
              tint.setHSL(0.91 + Math.random() * 0.05, 0.62, 0.56 + Math.random() * 0.22);
              inst.setColorAt(i, tint);
            }
            inst.instanceMatrix.needsUpdate = true;
            if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
            inst.frustumCulled = false;      // bbox instancji i tak obejmuje całą koronę
            root.add(inst);

            {
              const bb = new THREE.Box3().setFromObject(gltf.scene);
              const sz = bb.getSize(new THREE.Vector3());
              const crownW = Math.max(sz.x, sz.z);
              crownCenter.set(0, (treeHeight * (BLOSSOM_FROM + 1) * 0.5 + treeHeight * 0.05) * TREE_STRETCH, 0);
              const gm = new THREE.ShaderMaterial({
                uniforms: { uCol: { value: new THREE.Color(0xff7fc0) }, uK: { value: CROWN_GLOW } },
                vertexShader: `
                  varying vec2 vUv;
                  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
                fragmentShader: `
                  uniform vec3 uCol; uniform float uK;
                  varying vec2 vUv;
                  void main() {
                    float r = length(vUv * 2.0 - 1.0);
                    float a = exp(-r * r * 3.2) * uK;
                    gl_FragColor = vec4(uCol * a, a);
                  }`,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
              });
              const glowSize = crownW * CROWN_GLOW_SIZE;
              crownGlow = new THREE.Mesh(new THREE.PlaneGeometry(glowSize, glowSize), gm);
              crownGlow.renderOrder = 0;
              root.add(crownGlow);
            }

            // ── pagórek ────────────────────────────────────────────────
            // Drzewo stojące na płaskim zerze wygląda jak wklejone. Kopuła
            // z siatki 120×120, wysokość liczona funkcją, a nie z tekstury —
            // ta sama funkcja sadza potem opadłe płatki na zboczu.
            const mR = fitSize * MOUND_R;
            const mH = treeHeight * MOUND_H;
            // Promień „eliptyczny": wyspa jest wydłużona wzdłuż X, więc
            // odległość liczymy po ściśniętej osi. Ta sama miara idzie do
            // wysokości, koloru i rozrzutu płatków.
            const moundT = (x: number, z: number) =>
              Math.min(Math.hypot(x / MOUND_STRETCH, z) / mR, 1);
            const moundAt = (x: number, z: number) => {
              const t = moundT(x, z);
              // Płaski szczyt: kopuła zaczyna opadać dopiero za MOUND_TOP,
              // żeby drzewo stało na półce, a nie na czubku
              const ts = Math.max(t - MOUND_TOP, 0) / (1 - MOUND_TOP);
              const dome = 0.5 * Math.cos(ts * Math.PI) + 0.5;
              const bump = Math.sin(x * 1.7 + z * 0.9) * Math.cos(z * 1.3 - x * 0.6);
              return mH * (dome + bump * MOUND_BUMP * dome);
            };

            // Krążek, nie kwadrat: przy kwadratowej siatce widać proste
            // krawędzie podłoża, choćby kolor gasł do tła. RingGeometry
            // z wewnętrznym promieniem 0 daje podziały wzdłuż promienia,
            // których CircleGeometry nie ma (tam środek to jeden wierzchołek).
            const mGeo = new THREE.RingGeometry(0, mR * 1.35 * MOUND_STRETCH, 128, 48);
            mGeo.rotateX(-Math.PI / 2);
            const mp = mGeo.attributes.position;
            const mc = new Float32Array(mp.count * 3);
            const cTop = new THREE.Color(0x8d4a84);   // grzbiet, blisko pnia
            const cLow = new THREE.Color(0x24162c);   // zbocze
            const tmp = new THREE.Color();
            for (let i = 0; i < mp.count; i++) {
              const x = mp.getX(i), z = mp.getZ(i);
              const t = moundT(x, z);
              mp.setY(i, moundAt(x, z));
              tmp.copy(cLow).lerp(cTop, Math.pow(1 - t, 2.2));
              // Wygaszanie rozciągnięte na całe zbocze, nie tylko na rant.
              // Pagórek oglądamy pod ostrym kątem, więc ostatnie procenty
              // promienia to na ekranie kilka pikseli i krótka rampa czyta
              // się jako narysowana elipsa.
              // Odkąd jest woda, rant i tak jest pod powierzchnią — wygaszanie
              // może być łagodne, inaczej całe zbocze robi się czarną bryłą.
              const f = Math.min(Math.max((1.0 - t) / 0.5, 0), 1);
              tmp.multiplyScalar(f * f * (3 - 2 * f));
              mc[i * 3] = tmp.r; mc[i * 3 + 1] = tmp.g; mc[i * 3 + 2] = tmp.b;
            }
            mGeo.setAttribute('color', new THREE.BufferAttribute(mc, 3));
            mGeo.computeVertexNormals();
            // Lambert, nie Standard: PBR dokłada 4% odbicia lustrzanego
            // niezależnie od albedo, więc przy mocnym kluczu całe zbocze
            // dostawało stałe szare dno ~24/255 i wygaszanie do czerni nic
            // nie dawało. Lambert liczy samo rozproszenie.
            const mound = new THREE.Mesh(mGeo, new THREE.MeshLambertMaterial({
              vertexColors: true,
            }));
            mound.position.y = -mH * 0.45;   // pień wchodzi w zbocze, nie stoi na nim
            mound.layers.enable(LAYER_OCCLUDER);
            root.add(mound);

            // ── woda ───────────────────────────────────────────────────
            // Reflector renderuje scenę drugi raz z kamery odbitej względem
            // tafli. Dlatego trzyma się małej rozdzielczości i dlatego woda
            // powstaje po drzewie — musi mieć co odbijać.
            const waterY = mound.position.y + mH * WATER_LEVEL;
            const waterR = fitSize * 14;   // horyzont daleko, żeby nie rysował kreski
            water = new Reflector(new THREE.PlaneGeometry(waterR, waterR), {
              textureWidth: WATER_RES,
              textureHeight: WATER_RES,
              color: 0xd8cff0,   // odbicie jasne – warstwa tafli i tak je tłumi
            });
            water.rotation.x = -Math.PI / 2;
            water.position.y = waterY;
            root.add(water);

            // ── góry ───────────────────────────────────────────────────
            // Walec dookoła sceny, oglądany od środka. Tekstura powtarzana
            // lustrzanie — zwykłe powtórzenie zostawia szew tam, gdzie lewa
            // i prawa krawędź obrazka się nie zgadzają. Stoi tuż przed
            // krawędzią wody, gdzie tafla i tak gaśnie do tła, a podstawa
            // ma w teksturze wpisaną mgłę w kolorze wody.
            {
              const mR2 = waterR * 0.5 * 0.96;
              const mTex = new THREE.TextureLoader().load('/scene/mountains.webp');
              mTex.colorSpace = THREE.SRGBColorSpace;
              mTex.wrapS = THREE.MirroredRepeatWrapping;
              mTex.repeat.x = MOUNTAIN_REPEAT;
              const mH2 = treeHeight * MOUNTAIN_H;
              const mountains = new THREE.Mesh(
                new THREE.CylinderGeometry(mR2, mR2, mH2, 96, 1, true),
                new THREE.MeshBasicMaterial({
                  map: mTex,
                  color: 0xd8c4dc,   // nowy obrazek jest już w palecie, tylko lekko przygaszony
                  transparent: true,
                  side: THREE.BackSide,
                  depthWrite: false,
                  fog: false,
                })
              );
              mountains.position.y = waterY + mH2 * 0.5 - mH2 * 0.3;   // podstawa głęboko pod wodą
              // oś lustra poza kadrem startowym – inaczej szczyty układają
              // się symetrycznie po obu stronach drzewa
              mountains.rotation.y = Math.PI / MOUNTAIN_REPEAT * 0.5;
              mountains.renderOrder = -1;   // po gwiazdach, przed wodą
              root.add(mountains);
              // Chmury: walec o włos większy, wyżej. Zamiast tekstury —
              // szum fbm w shaderze. Próbkowany po okręgu w przestrzeni
              // szumu, więc jest okresowy dookoła bez żadnego szwu, a czas
              // przesuwa go i powoli zmienia kształt. Obrazek chmur wyglądał
              // sztucznie: jedna klatka powtórzona cztery razy, twarde
              // krawędzie po wycinaniu i zero życia.
              const cH = treeHeight * CLOUD_H;
              const clouds = new THREE.Mesh(
                new THREE.CylinderGeometry(mR2 * 1.02, mR2 * 1.02, cH, 96, 1, true),
                new THREE.ShaderMaterial({
                  uniforms: {
                    uTime,
                    uDark: { value: new THREE.Color(0x0a0512) },
                    uLight: { value: new THREE.Color(0x3d2a58) },
                    uRim: { value: new THREE.Color(0xd9a6e8) },
                    uCover: { value: CLOUD_COVER },
                    uSoft: { value: CLOUD_SOFT },
                    uOpacity: { value: CLOUD_OPACITY },
                    uDrift: { value: CLOUD_DRIFT },
                    uEvolve: { value: CLOUD_EVOLVE },
                    uMoonAz: { value: MOON_AZIMUTH },
                    uMoonCol: { value: new THREE.Color(MOON_COLOR) },
                    uMoonVis: { value: 1 },
                  },
                  vertexShader: `
                    varying vec2 vUv;
                    void main() {
                      vUv = uv;
                      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }`,
                  fragmentShader: `
                    uniform float uTime, uCover, uSoft, uOpacity, uDrift, uEvolve, uMoonAz, uMoonVis;
                    uniform vec3 uDark, uLight, uRim, uMoonCol;
                    varying vec2 vUv;
                    float hash(vec3 p) {
                      p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
                      p *= 17.0;
                      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                    }
                    float noise(vec3 x) {
                      vec3 i = floor(x), f = fract(x);
                      f = f * f * (3.0 - 2.0 * f);
                      return mix(
                        mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
                    }
                    float fbm(vec3 p) {
                      float a = 0.5, s = 0.0;
                      for (int i = 0; i < 5; i++) {
                        s += a * noise(p);
                        p = p * 2.03 + vec3(3.1, 1.7, 0.9);
                        a *= 0.5;
                      }
                      return s;
                    }
                    void main() {
                      // okrąg w przestrzeni szumu = brak szwu dookoła walca
                      float ang = vUv.x * 6.2831853 + uTime * uDrift;
                      float R = 3.2;
                      vec3 p = vec3(cos(ang) * R, sin(ang) * R, vUv.y * 2.6 + uTime * uEvolve);
                      float n = fbm(p) + 0.12 * fbm(p * 3.1 + 7.0) - 0.06;
                      // chmury żyją w pasie: nic przy samych szczytach gór,
                      // rzednące ku górze kadru
                      float band = smoothstep(0.02, 0.28, vUv.y) * (1.0 - smoothstep(0.55, 0.95, vUv.y));
                      float d = smoothstep(uCover, uCover + uSoft, n) * band;
                      // cieniowanie: gęstsze partie ciemniejsze, brzegi
                      // podświetlone – jak od blasku za chmurą
                      float thick = smoothstep(uCover, uCover + 0.45, n);
                      float rim = d * (1.0 - thick);
                      vec3 col = mix(uLight, uDark, thick);
                      col = mix(col, uRim, rim * 0.55);
                      // od strony księżyca chmury łapią jego kolor, brzegi
                      // najmocniej – CylinderGeometry ma u=0 na +Z, tak jak
                      // nasz azymut, więc kąt czyta się wprost z uv
                      float lit = pow(max(cos(vUv.x * 6.2831853 - uMoonAz), 0.0), 3.0);
                      col = mix(col, uMoonCol, lit * (0.35 + 0.65 * rim) * uMoonVis);
                      gl_FragColor = vec4(col, d * uOpacity);
                    }`,
                  transparent: true,
                  side: THREE.BackSide,
                  depthWrite: false,
                })
              );
              clouds.position.y = waterY + mH2 * 0.35 + cH * 0.5;
              clouds.renderOrder = -2;      // za górami, przed gwiazdami
              root.add(clouds);
              cloudMat = clouds.material as THREE.ShaderMaterial;

              // Księżyc: tarcza + poświata, obie zawsze zwrócone do kamery
              // (ustawiane w pętli). Góry nie piszą głębi, więc kolejność
              // rysowania robi za zasłanianie: tarcza idzie przed nimi.
              const moonR = treeHeight * MOON_SIZE * 10 * 0.5;
              // Tarcza z obrazka (public/scene/moon.webp, z własną alfą i
              // poświatą przy brzegu); wcześniejsza proceduralna miała plamy
              // jak z kałuży. Halo pod spodem zostaje, tylko słabsze.
              const moonTex = new THREE.TextureLoader().load('/scene/moon.webp');
              moonTex.colorSpace = THREE.SRGBColorSpace;
              const moonMat = new THREE.MeshBasicMaterial({
                map: moonTex,
                transparent: true,
                depthWrite: false,
              });
              const moon = new THREE.Mesh(new THREE.PlaneGeometry(moonR * 2.5, moonR * 2.5), moonMat);  // ×2.5: w obrazku tarcza ma ~80% szerokości
              const haloMat = new THREE.ShaderMaterial({
                uniforms: { uCol: { value: new THREE.Color(MOON_COLOR) }, uK: { value: MOON_GLOW } },
                vertexShader: `
                  varying vec2 vUv;
                  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
                fragmentShader: `
                  uniform vec3 uCol; uniform float uK;
                  varying vec2 vUv;
                  void main() {
                    float r = length(vUv * 2.0 - 1.0);
                    float a = exp(-r * 4.2) * uK;
                    gl_FragColor = vec4(uCol * a, a);
                  }`,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
              });
              const halo = new THREE.Mesh(new THREE.PlaneGeometry(moonR * 7, moonR * 7), haloMat);
              moonDist = mR2 * 1.04;
              const moonY = waterY + mH2 * 0.5 + moonR * (2.0 * MOON_ELEV - 1.0);
              moon.position.set(Math.sin(MOON_AZIMUTH) * moonDist, moonY, Math.cos(MOON_AZIMUTH) * moonDist);
              halo.position.copy(moon.position);
              moonBaseY = moonY;
              moonRise = moonR * 2 * MOON_RISE;
              moon.renderOrder = -2.6;
              halo.renderOrder = -2.5;
              root.add(moon, halo);
              moonBillboards = [moon, halo];
              moonMats.disc = moonMat;
              moonMats.halo = haloMat;

              // Do odbicia nie wchodzą – z daleka i tak byłyby smugą,
              // a Reflector nie lubi przezroczystych walców wokół siebie.
              if (water) {
                const pass = water.onBeforeRender;
                water.onBeforeRender = (...args) => {
                  // góry zostają w odbiciu; chmury i księżyc nie (chmury:
                  // drugi przebieg najcięższego shadera w scenie; księżyc:
                  // lustrzana tarcza wyglądała jak czerwone koło na wodzie)
                  clouds.visible = false;
                  // księżyc też: lustrzana tarcza pod horyzontem wygląda jak
                  // czerwone koło na wodzie; odbicie robi smuga w shaderze tafli
                  for (const b of moonBillboards) b.visible = false;
                  pass.apply(water, args);
                  clouds.visible = true;
                  for (const b of moonBillboards) b.visible = true;
                };
              }
            }

            // Tafla: sam Reflector daje czerń wszędzie tam, gdzie odbija
            // puste niebo, więc wody nie było widać. Ta warstwa nad nim
            // maluje ton wody (głębia blisko, mgiełka przy horyzoncie),
            // różową poświatę pod drzewem i zmarszczki; odbicie prześwituje
            // przez nią, a przy krawędzi płaszczyzny kolor zlewa się z tłem.
            const surface = new THREE.Mesh(
              new THREE.PlaneGeometry(waterR, waterR),
              new THREE.ShaderMaterial({
                uniforms: {
                  uTime,
                  uCol: { value: new THREE.Color(0xff6fa8) },
                  uDeep: { value: new THREE.Color(0x0e0614) },
                  uHaze: { value: new THREE.Color(0x30183a) },
                  uCam: { value: new THREE.Vector3() },
                  uMoonDir: { value: new THREE.Vector2(Math.sin(MOON_AZIMUTH), Math.cos(MOON_AZIMUTH)) },
                  uMoonCol: { value: new THREE.Color(MOON_COLOR) },
                  uMoonVis: { value: 1 },
                  uBg: { value: new THREE.Color(0x020105) },
                  uFar: { value: waterR * 0.5 },
                  uFwd: { value: new THREE.Vector2(0, -1) },
                },
                vertexShader: `
                  varying vec2 vW;
                  void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vW = wp.xz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                  }`,
                fragmentShader: `
                  uniform float uTime;
                  uniform vec3 uCol, uDeep, uHaze, uBg;
                  uniform float uFar;
                  uniform vec2 uFwd;
                  uniform vec3 uCam;
                  uniform vec2 uMoonDir;
                  uniform vec3 uMoonCol;
                  uniform float uMoonVis;
                  varying vec2 vW;
                  void main() {
                    float d = length(vW);
                    // Pasy w układzie kamery: py rośnie w głąb kadru, px
                    // w bok. Pasy przybite do osi świata przy obrocie raz
                    // leżały w poprzek, raz wzdłuż ekranu.
                    float py = dot(vW, uFwd);
                    float px = dot(vW, vec2(-uFwd.y, uFwd.x));
                    float far = smoothstep(0.0, uFar * 0.7, d);
                    vec3 tone = mix(uDeep, uHaze, far);
                    // poświata drzewa na wodzie
                    float pool = exp(-d * 0.28);
                    // Wersja izotropowa (sześć fal co 60°) przestała
                    // wyglądać jak fale — zostają poziome pasy.
                    float b = sin(py * 3.1 + uTime * 0.7)
                            + 0.7 * sin(py * 6.7 - uTime * 1.1 + px * 0.9)
                            + 0.5 * sin(px * 0.9 + py * 1.4 + uTime * 0.5)
                            + 0.4 * sin(py * 9.1 + px * 1.3 + uTime * 0.9);
                    float streak = pow(max(b * 0.3 + 0.5, 0.0), 3.0);
                    vec3 col = tone
                             + uCol * pool * (0.10 + 0.22 * streak)
                             + uHaze * streak * 0.7 * (1.0 - far * 0.6);
                    // Smuga księżyca: jasna tam, gdzie kierunek od kamery do
                    // punktu na wodzie pokrywa się z kierunkiem na księżyc.
                    // Zależna od widza jak prawdziwe odbicie; zmarszczki ją
                    // rwą na poziome pasma. Reflector jej nie da — tarcza
                    // stoi za nieprzezroczystą mgiełką przy horyzoncie.
                    vec2 toP = normalize(vW - uCam.xz);
                    float along = max(dot(toP, uMoonDir), 0.0);
                    float lane = pow(along, 60.0);
                    float glint = lane * (0.35 + 0.65 * streak) * (0.25 + 0.75 * far);
                    col += uMoonCol * glint * 0.8 * uMoonVis;
                    // Warstwa nigdzie nie kryje w całości – przy horyzoncie
                    // ma prześwitywać odbicie gór.
                    float alpha = mix(0.6, 0.8, far);
                    // Brzeg płaszczyzny: odkąd horyzont zasłaniają góry,
                    // gaśnie tylko ostatni skrawek. Wcześniejszy szeroki
                    // spadek do czerni rysował ciemny pas pod górami.
                    float edge = 1.0 - smoothstep(uFar * 0.97, uFar, d);
                    gl_FragColor = vec4(mix(uBg, col, edge), mix(1.0, alpha, edge));
                  }`,
                transparent: true,
                depthWrite: false,
              })
            );
            surface.rotation.x = -Math.PI / 2;
            surface.position.y = waterY + 0.01;
            surface.renderOrder = 1;
            // Do przebiegu głębi pod napisem. Bierzemy tę płaszczyznę, nie
            // Reflector: on w onBeforeRender renderuje całe odbicie i drugi
            // przebieg podwoiłby najdroższy element sceny. Ta jest tylko
            // płaskim quadem, a głębię daje identyczną.
            surface.layers.enable(LAYER_OCCLUDER);
            root.add(surface);
            waterMat = surface.material as THREE.ShaderMaterial;

            // ── tytuł ──────────────────────────────────────────────────
            // Czekamy na font: Cormorant dochodzi asynchronicznie, a canvas
            // 2D wypaliłby napis tym, co akurat jest pod ręką.
            document.fonts.ready.then(() => {
              if (disposed) return;
              const { tex, aspect } = titleTexture(TITLE.text);
              titleTex = tex;
              const tw = fitSize * TITLE.width;
              const th = tw / aspect;
              titleMat = new THREE.ShaderMaterial({
                uniforms: {
                  uMap: { value: tex },
                  uSink: { value: 1 },
                  uOpacity: { value: 1 },
                },
                vertexShader: `
                  varying vec2 vUv;
                  void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                  }`,
                fragmentShader: `
                  uniform sampler2D uMap;
                  uniform float uSink;
                  uniform float uOpacity;
                  varying vec2 vUv;
                  void main() {
                    // uSink zsuwa napis w dół względem płaszczyzny. Jej dolna
                    // krawędź leży na tafli, więc co zejdzie poniżej – tonie.
                    vec2 uv = vUv + vec2(0.0, uSink);
                    if (uv.y > 1.0) discard;
                    vec4 t = texture2D(uMap, uv);
                    gl_FragColor = vec4(t.rgb, t.a * uOpacity);
                  }`,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,   // Reflector patrzy od spodu
              });
              titleMesh = new THREE.Mesh(new THREE.PlaneGeometry(tw, th), titleMat);
              titleMesh.position.y = waterY + th * (0.5 + TITLE.lift);
              titleMesh.renderOrder = 1;
              // Warstwa 0 zostaje: kamera Reflectora widzi tylko ją i tylko tak
              // napis trafi do odbicia. Warstwa TITLE – do osobnego przebiegu.
              titleMesh.layers.enable(LAYER_TITLE);
              root.add(titleMesh);

              // W trybie fluid napis jest niewidoczny podczas renderu kadru,
              // żeby nie przeszedł przez smugę – ale w odbiciu ma być. Reflector
              // renderuje scenę w swoim onBeforeRender, więc na ten moment go
              // odsłaniamy. Lista obiektów zewnętrznego renderu jest już
              // zbudowana, więc zewnętrzny kadr go nie złapie.
              if (fluid && water) {
                titleMesh.visible = false;
                const pass = water.onBeforeRender;
                water.onBeforeRender = (...args) => {
                  if (titleMesh) titleMesh.visible = true;
                  pass.apply(water, args);
                  if (titleMesh) titleMesh.visible = false;
                };
              }
            });

            // Opadłe płatki: te same karty, tylko płasko i z losowym obrotem
            // wokół pionu. Gęściej pod koroną niż przy krawędzi — stąd
            // wykładnik >1 zamiast równomiernego rozrzutu po kole.
            const fallen = new THREE.InstancedMesh(geo, mat, GROUND_PETALS);
            for (let i = 0; i < GROUND_PETALS; i++) {
              const a = Math.random() * Math.PI * 2;
              const d = Math.pow(Math.random(), 1.35) * mR * 1.25;
              const x = Math.cos(a) * d * MOUND_STRETCH, z = Math.sin(a) * d;
              dummy.position.set(x, moundAt(x, z) - mH * 0.45 + 0.02, z);
              dummy.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.5,
                                 Math.random() * Math.PI * 2, 0);
              const sc = size * (0.7 + Math.random() * 0.7);
              dummy.scale.set(sc, sc, sc);
              dummy.updateMatrix();
              fallen.setMatrixAt(i, dummy.matrix);
              tint.setHSL(0.91 + Math.random() * 0.05, 0.5, 0.34 + Math.random() * 0.16);
              fallen.setColorAt(i, tint);
            }
            fallen.instanceMatrix.needsUpdate = true;
            if (fallen.instanceColor) fallen.instanceColor.needsUpdate = true;
            root.add(fallen);

            // ── płatki na wodzie ────────────────────────────────────────
            // Osobny materiał, bo wiatr z korony gaśnie przy ziemi
            // (smoothstep po wysokości) — te mają własny, powolny dryf
            // po tafli. Przesunięcie dokładane PO instanceMatrix, w
            // przestrzeni świata: karty leżą płasko, więc ich lokalne osie
            // nie pokrywają się ze światem.
            const floatMat = new THREE.MeshStandardMaterial({
              map: petalMap,
              roughness: 0.6,
              metalness: 0,
              side: THREE.DoubleSide,
              alphaTest: 0.5,
              transparent: false,
              emissive: new THREE.Color(0xff6fae),
              emissiveIntensity: 0.08,
            });
            floatMat.onBeforeCompile = (shader) => {
              shader.uniforms.uTime = uTime;
              shader.uniforms.uDrift = { value: treeHeight * FLOAT_DRIFT };
              shader.vertexShader =
                'uniform float uTime;\nuniform float uDrift;\n' +
                shader.vertexShader.replace('#include <project_vertex>', `
                  vec4 mvPosition = vec4(transformed, 1.0);
                  #ifdef USE_INSTANCING
                    mvPosition = instanceMatrix * mvPosition;
                    vec3 iPos = instanceMatrix[3].xyz;
                    float ph = iPos.x * 0.5 + iPos.z * 0.7;
                    mvPosition.xyz += vec3(
                      sin(uTime * 0.35 + ph),
                      0.12 * sin(uTime * 1.3 + ph * 2.0),
                      cos(uTime * 0.28 + ph * 1.3)) * uDrift;
                  #endif
                  mvPosition = modelViewMatrix * mvPosition;
                  gl_Position = projectionMatrix * mvPosition;`);
            };
            const floating = new THREE.InstancedMesh(geo, floatMat, FLOAT_PETALS);
            const shore = mR * 0.95;
            for (let i = 0; i < FLOAT_PETALS; i++) {
              const a = Math.random() * Math.PI * 2;
              // od brzegu wyspy w głąb wody, gęściej blisko brzegu
              const d = shore + Math.pow(Math.random(), 1.6) * fitSize * 1.3;
              dummy.position.set(Math.cos(a) * d, waterY + 0.015, Math.sin(a) * d);
              dummy.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.12,
                                 Math.random() * Math.PI * 2, 0);
              const sc = size * (0.6 + Math.random() * 0.6);
              dummy.scale.set(sc, sc, sc);
              dummy.updateMatrix();
              floating.setMatrixAt(i, dummy.matrix);
              tint.setHSL(0.91 + Math.random() * 0.05, 0.45, 0.38 + Math.random() * 0.18);
              floating.setColorAt(i, tint);
            }
            floating.instanceMatrix.needsUpdate = true;
            if (floating.instanceColor) floating.instanceColor.needsUpdate = true;
            floating.frustumCulled = false;
            root.add(floating);
          }
        }

        // Światełka: jeden obiekt Points zamiast setek siatek. Additive
        // blending daje poświatę bez pełnoekranowego bloomu, który kosztuje
        // osobny pass renderowany na całym ekranie co klatkę.
        const pos: number[] = [];
        const size: number[] = [];
        for (const [x, y0, z] of data.tips) {
          const y = y0 * TREE_STRETCH;   // tips.json jest w skali modelu sprzed rozciągnięcia
          for (let i = 0; i < 2; i++) {
            pos.push(
              x + (Math.random() - 0.5) * 0.35,
              y + (Math.random() - 0.5) * 0.35,
              z + (Math.random() - 0.5) * 0.35
            );
            size.push(0.18 + Math.random() * 0.5);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));

        const mat = new THREE.ShaderMaterial({
          uniforms: {
            uTex: { value: tex },
            uTime,
            uWind: { value: 0 },
            uH: { value: 1 },
          },
          vertexShader: `
            attribute float aSize;
            uniform float uTime;
            uniform float uWind;
            uniform float uH;
            varying float vTwinkle;
            void main() {
              // ta sama funkcja wiatru co w kwiatach, żeby światła jechały
              // razem z płatkami
              float ph = position.x * 0.7 + position.z * 0.9 + position.y * 0.3;
              float g = smoothstep(0.15, 1.0, position.y / uH);
              float sx = sin(uTime * 1.1 + ph) + 0.4 * sin(uTime * 2.3 + ph * 1.7);
              float sz = cos(uTime * 0.9 + ph * 1.3);
              vec3 p = position + vec3(sx, sx * 0.25, sz * 0.7) * (uWind * g);
              vec4 mv = modelViewMatrix * vec4(p, 1.0);
              // każdy punkt pulsuje z własną fazą wziętą z pozycji
              vTwinkle = 0.65 + 0.35 * sin(uTime * 1.6 + position.x * 3.1 + position.y * 2.3);
              gl_PointSize = aSize * 300.0 / -mv.z;
              gl_Position = projectionMatrix * mv;
            }`,
          fragmentShader: `
            uniform sampler2D uTex;
            varying float vTwinkle;
            void main() {
              vec4 t = texture2D(uTex, gl_PointCoord);
              gl_FragColor = vec4(t.rgb, t.a * vTwinkle);
            }`,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
        });
        mat.uniforms.uWind.value = treeHeight * WIND;
        mat.uniforms.uH.value = treeHeight;
        points = new THREE.Points(geo, mat);
        points.renderOrder = 2;
        root.add(points);

        // ── gwiazdy ────────────────────────────────────────────────────
        // Górna półkula daleko za sceną. Poniżej horyzontu zasłania je
        // tafla (przy horyzoncie kryje w całości), więc nie trzeba ich
        // wycinać osobno. Migotanie i rozmiar per gwiazda w shaderze.
        {
          const R = fitSize * 11;
          const sp: number[] = [];
          const ss: number[] = [];
          const sph: number[] = [];
          for (let i = 0; i < STARS; i++) {
            const u = Math.random();
            const v = Math.random();
            const theta = u * Math.PI * 2;
            // cos(phi) równomiernie -> równomiernie po sferze; tylko góra
            const y = 0.06 + v * 0.94;
            const r = Math.sqrt(1 - y * y);
            sp.push(Math.cos(theta) * r * R, y * R, Math.sin(theta) * r * R);
            // większość drobna, kilka wyraźnych
            const big = Math.random() < 0.08;
            ss.push((big ? 2.2 + Math.random() * 2.0 : 0.5 + Math.random() * 1.1) * (R / 26) * STAR_SIZE);
            sph.push(Math.random() * Math.PI * 2);
          }
          const sg = new THREE.BufferGeometry();
          sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
          sg.setAttribute('aSize', new THREE.Float32BufferAttribute(ss, 1));
          sg.setAttribute('aPhase', new THREE.Float32BufferAttribute(sph, 1));
          const sm = new THREE.ShaderMaterial({
            uniforms: { uTex: { value: starTex }, uTime, uTw: { value: STAR_TWINKLE } },
            vertexShader: `
              attribute float aSize;
              attribute float aPhase;
              uniform float uTime;
              uniform float uTw;
              varying float vTw;
              void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                // dwie częstotliwości: wolne falowanie plus szybki błysk,
                // żeby nie pulsowały jak na jednym metronomie
                float t = uTime * uTw;
                vTw = 0.45
                    + 0.35 * sin(t * (0.6 + fract(aPhase) * 0.9) + aPhase * 7.0)
                    + 0.20 * sin(t * (1.7 + fract(aPhase * 3.1) * 1.4) + aPhase * 3.0);
                gl_PointSize = aSize * 300.0 / -mv.z;
                gl_Position = projectionMatrix * mv;
              }`,
            fragmentShader: `
              uniform sampler2D uTex;
              varying float vTw;
              void main() {
                vec4 t = texture2D(uTex, gl_PointCoord);
                gl_FragColor = vec4(t.rgb, t.a * vTw);
              }`,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          });
          const stars = new THREE.Points(sg, sm);
          stars.renderOrder = -3;
          stars.frustumCulled = false;
          root.add(stars);

          // Gwiazdy nie wchodzą do odbicia: lustrzana kamera patrzy spod
          // tafli w górę i łapie te przy horyzoncie, których z góry nie
          // widać — woda była gęściej usiana gwiazdami niż niebo.
          if (water) {
            const pass = water.onBeforeRender;
            water.onBeforeRender = (...args) => {
              stars.visible = false;
              pass.apply(water, args);
              stars.visible = true;
            };
          }
        }

        // ── motyle ─────────────────────────────────────────────────────
        // Cała trasa liczona w shaderze z czasu i paru liczb per motyl:
        // okrąg wokół korony (promień, prędkość, faza) plus falowanie
        // w pionie. Kierunek lotu to pochodna trasy, skrzydła składają się
        // wokół osi ciała. Zero pracy na CPU, jeden draw call.
        {
          const base = new THREE.PlaneGeometry(1, 1, 2, 1);
          const fg = new THREE.InstancedBufferGeometry();
          fg.index = base.index;
          fg.attributes.position = base.attributes.position;
          fg.attributes.uv = base.attributes.uv;
          fg.instanceCount = BUTTERFLIES;
          const aA: number[] = [], aB: number[] = [], aC: number[] = [];
          const aS: number[] = [], aCol: number[] = [];
          const col = new THREE.Color();
          for (let i = 0; i < BUTTERFLIES; i++) {
            const dir = Math.random() < 0.5 ? -1 : 1;
            aA.push(
              dir * (0.12 + Math.random() * 0.2),        // prędkość kątowa
              Math.random() * Math.PI * 2,               // faza
              fitSize * (0.5 + Math.random() * 0.3),     // promień okrążania: na zewnątrz korony
              treeHeight * (0.05 + Math.random() * 0.08) // amplituda pionowa
            );
            aB.push(
              0.5 + Math.random() * 0.9,                 // tempo falowania
              Math.random() * Math.PI * 2,
              9 + Math.random() * 5,                     // tempo machania
              Math.random() * Math.PI * 2
            );
            aC.push(
              (Math.random() - 0.5) * fitSize * 0.25,
              treeHeight * (0.6 + Math.random() * 0.45),
              (Math.random() - 0.5) * fitSize * 0.25
            );
            aS.push(treeHeight * BUTTERFLY_SIZE * (0.7 + Math.random() * 0.6));
            col.setHSL(Math.random() < 0.5 ? 0.52 + Math.random() * 0.06 : 0.88 + Math.random() * 0.06,
                       0.9, 0.7);
            aCol.push(col.r, col.g, col.b);
          }
          fg.setAttribute('aA', new THREE.InstancedBufferAttribute(new Float32Array(aA), 4));
          fg.setAttribute('aB', new THREE.InstancedBufferAttribute(new Float32Array(aB), 4));
          fg.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(aC), 3));
          fg.setAttribute('aScale', new THREE.InstancedBufferAttribute(new Float32Array(aS), 1));
          fg.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(aCol), 3));

          const fm = new THREE.ShaderMaterial({
            uniforms: { uTex: { value: flyTex }, uTime, uAlpha: uFly },
            vertexShader: `
              attribute vec4 aA;
              attribute vec4 aB;
              attribute vec3 aCenter;
              attribute float aScale;
              attribute vec3 aColor;
              uniform float uTime;
              varying vec2 vUv;
              varying vec3 vColor;
              void main() {
                float t = uTime;
                float ang = aA.x * t + aA.y;
                vec3 p = aCenter + vec3(aA.z * cos(ang),
                                        aA.w * sin(aB.x * t + aB.y),
                                        aA.z * sin(ang));
                // kierunek lotu = pochodna trasy w poziomie
                vec2 h = normalize(vec2(-sin(ang), cos(ang)) * aA.x);
                vec3 heading = vec3(h.x, 0.0, h.y);
                vec3 right = vec3(-h.y, 0.0, h.x);
                // skrzydła składają się do góry wokół osi ciała
                float flap = sin(t * aB.z + aB.w) * 1.05;
                vec3 local = vec3(position.x * cos(flap), position.y, abs(position.x) * sin(flap));
                vec3 world = p + (right * local.x + heading * local.y + vec3(0.0, 1.0, 0.0) * local.z) * aScale;
                vUv = uv;
                vColor = aColor;
                gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
              }`,
            fragmentShader: `
              uniform sampler2D uTex;
              uniform float uAlpha;
              varying vec2 vUv;
              varying vec3 vColor;
              void main() {
                vec4 t = texture2D(uTex, vUv);
                gl_FragColor = vec4(t.rgb * vColor * 1.4, t.a * uAlpha);
              }`,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          });
          const flies = new THREE.Mesh(fg, fm);
          flies.frustumCulled = false;
          flies.renderOrder = 3;
          root.add(flies);
        }

      })
      .catch((e) => console.error('[tree] nie udało się wczytać modelu', e));

    /** Progress scrolla liczony z pozycji sekcji – bez bibliotek. */
    const scrollProgress = () => {
      const r = sectionEl.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      if (total <= 0) return 0;
      return Math.min(Math.max(-r.top / total, 0), 1);
    };

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), {
      rootMargin: '150px',
    });
    io.observe(el);

    const t0 = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible) return;

      // wygładzenie zamiast scruba z GSAP-a: dociąganie do celu co klatkę
      const target = scrollProgress();
      smooth += (target - smooth) * (reduce ? 1 : 0.12);

      const k = sampleKeys(smooth);
      const r = k.radius * fitSize;
      camera.position.set(Math.sin(k.angle) * r, k.height * treeHeight, Math.cos(k.angle) * r);
      camera.lookAt(0, k.look * treeHeight, 0);

      // Klucz zawsze po lewej stronie kadru, rim po prawej i zza drzewa.
      // Cel obu lamp zostaje w zerze, więc liczy się sam kierunek.
      fwd.copy(camera.position).negate().normalize();
      right.crossVectors(fwd, UP).normalize();
      key.position.copy(camera.position)
        .addScaledVector(right, -r * LIGHT_SIDE)
        .addScaledVector(UP, treeHeight * LIGHT_UP);
      uLight.value.copy(key.position).normalize();
      if (waterMat) {
        (waterMat.uniforms.uFwd.value as THREE.Vector2).set(fwd.x, fwd.z).normalize();
        (waterMat.uniforms.uCam.value as THREE.Vector3).copy(camera.position);
      }
      // blask za koroną: odsunięty od kamery, żeby płatki zasłaniały środek
      if (crownGlow) {
        crownGlow.position.copy(crownCenter).addScaledVector(fwd, fitSize * 0.35);
        crownGlow.lookAt(camera.position);
      }

      // Księżyc: azymut liczony od kamery, więc przy orbicie zostaje za
      // drzewem, a offset przesuwa go w kadrze z prawej na lewą. Do tego
      // wschodzi. Ta sama pozycja idzie do smugi na wodzie i do chmur.
      {
        const t = Math.min(smooth / MOON_RISE_SPAN, 1);
        const e = t * t * (3 - 2 * t);
        const camAz = Math.atan2(camera.position.x, camera.position.z);
        const az = camAz + Math.PI + MOON_FROM + (MOON_TO - MOON_FROM) * e;
        const y = moonBaseY + moonRise * e;
        const vis = 1 - Math.min(Math.max((smooth - MOON_FADE_FROM) / MOON_FADE_SPAN, 0), 1);
        for (const b of moonBillboards) {
          b.position.set(Math.sin(az) * moonDist, y, Math.cos(az) * moonDist);
          b.lookAt(camera.position);
          b.visible = vis > 0.001;
        }
        if (moonMats.disc) moonMats.disc.opacity = vis;
        if (moonMats.halo) moonMats.halo.uniforms.uK.value = MOON_GLOW * vis;
        if (waterMat) waterMat.uniforms.uMoonVis.value = vis;
        if (cloudMat) cloudMat.uniforms.uMoonVis.value = vis;
        if (waterMat) (waterMat.uniforms.uMoonDir.value as THREE.Vector2).set(Math.sin(az), Math.cos(az));
        if (cloudMat) cloudMat.uniforms.uMoonAz.value = az;
      }
      rim.position.copy(camera.position)
        .addScaledVector(right, r * LIGHT_SIDE)
        .addScaledVector(fwd, r * 1.4)
        .addScaledVector(UP, treeHeight * 0.3);
      // przesunięcie drzewa w kadrze bez ruszania modelu
      camera.setViewOffset(
        el.clientWidth, el.clientHeight,
        -k.shiftX * el.clientWidth * 0.5, 0,
        el.clientWidth, el.clientHeight
      );
      camera.updateProjectionMatrix();

      if (titleMesh && titleMat) {
        // Zawsze po przeciwnej stronie drzewa niż kamera i obrócony do niej
        // samym yaw – pion zostaje, żeby napis stał na horyzoncie, a nie
        // kładł się razem z pochyleniem kamery.
        const cx = camera.position.x;
        const cz = camera.position.z;
        const cd = Math.hypot(cx, cz) || 1;
        titleMesh.position.x = (-cx / cd) * TITLE.dist * fitSize;
        titleMesh.position.z = (-cz / cd) * TITLE.dist * fitSize;
        titleMesh.rotation.y = Math.atan2(cx, cz);

        // wynurzanie na starcie, potem zatapianie, gdy rusza orbita
        const t = Math.min(Math.max(smooth / TITLE_OUT, 0), 1);
        const out = t * t * (3 - 2 * t);
        const intro = reduce ? 1 : Math.min((now - t0) / TITLE.rise, 1);
        const up = 1 - Math.pow(1 - intro, 3);
        titleMat.uniforms.uSink.value = Math.max(out, 1 - up);
        titleMat.uniforms.uOpacity.value = 1 - out;
      }
      for (let i = 0; i < CAPTIONS.length; i++) {
        const node = captionRefs.current[i];
        if (!node) continue;
        const c = CAPTIONS[i];
        const fadeIn = Math.min(Math.max((smooth - c.from) / CAPTION_FADE, 0), 1);
        const fadeOut = 1 - Math.min(Math.max((smooth - (c.to - CAPTION_FADE)) / CAPTION_FADE, 0), 1);
        const a = Math.min(fadeIn, fadeOut);
        const e = a * a * (3 - 2 * a);
        node.style.opacity = String(e);
        node.style.transform = reduce ? '' : `translateY(${(1 - e) * 20}px)`;
      }
      if (copyEl) {
        const t = Math.min(Math.max((smooth - COPY_FROM) / COPY_SPAN, 0), 1);
        copyEl.style.opacity = String(t);
        copyEl.style.transform = `translateY(${(1 - t) * 24}px)`;
      }

      uTime.value = reduce ? 0 : (now - t0) / 1000;
      {
        const f = Math.min(Math.max((smooth - BUTTERFLY_FROM) / 0.12, 0), 1);
        uFly.value = f * f * (3 - 2 * f);
      }
      if (fluid && sceneRT && flowRead && flowWrite && quad && quadScene && quadCam && skyMat && flowMat && compMat) {
        // 1. niebo + scena do tekstury
        skyMat.uniforms.uScroll.value = smooth;
        renderer.setRenderTarget(sceneRT);
        renderer.clear();
        quad.material = skyMat;
        renderer.render(quadScene, quadCam);
        renderer.autoClear = false;      // drzewo dorysowuje się NA niebie
        renderer.render(scene, camera);
        renderer.autoClear = true;

        // 2. pole przepływu: stara klatka wygasa, kursor dopisuje plamę
        flowMat.uniforms.tPrev.value = flowRead.texture;
        (flowMat.uniforms.uVelocity.value as THREE.Vector2)
          .copy(mouseVel)
          .multiplyScalar(reduce ? 0 : FLUID.gain);
        renderer.setRenderTarget(flowWrite);
        quad.material = flowMat;
        renderer.render(quadScene, quadCam);
        [flowRead, flowWrite] = [flowWrite, flowRead];

        // Wytracanie prędkości: bez tego zatrzymany kursor dalej pompuje
        // w pole ostatnią wartość i smuga nigdy nie przestaje rosnąć.
        mouseVel.multiplyScalar(0.86);

        // 3. kadr na ekran, z UV przesuniętym o pole
        compMat.uniforms.tFlow.value = flowRead.texture;
        renderer.setRenderTarget(null);
        quad.material = compMat;
        renderer.render(quadScene, quadCam);

        // 4. napis na wierzchu, bez smugi. Najpierw sami zasłaniacze do
        //    głębi (bez koloru), potem napis z testem głębi – pień go
        //    przecina tak samo, jak przecinałby w scenie.
        if (titleMesh) {
          renderer.autoClear = false;
          renderer.clearDepth();
          camera.layers.set(LAYER_OCCLUDER);
          scene.overrideMaterial = depthOnlyMat;
          renderer.render(scene, camera);
          scene.overrideMaterial = null;
          camera.layers.set(LAYER_TITLE);
          titleMesh.visible = true;
          renderer.render(scene, camera);
          titleMesh.visible = false;
          camera.layers.set(0);
          renderer.autoClear = true;
        }
      } else {
        renderer.render(scene, camera);
      }
    };
    raf = requestAnimationFrame(loop);

    const onResize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      // target kadru idzie za oknem; pole przepływu zostaje małe i kwadratowe
      sceneRT?.setSize(el.clientWidth, el.clientHeight);
      if (flowMat) flowMat.uniforms.uAspect.value = el.clientWidth / el.clientHeight;
      // sekcja jest w vh, więc jej wysokość zmienia się razem z oknem
      if (skyMat) skyMat.uniforms.uViewport.value = viewportFraction();    };
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      sceneRT?.dispose();
      flowRead?.dispose();
      flowWrite?.dispose();
      quad?.geometry.dispose();
      skyMat?.dispose();
      flowMat?.dispose();
      compMat?.dispose();
      renderer.dispose();
      tex.dispose();
      titleTex?.dispose();
      depthOnlyMat.dispose();
      starTex.dispose();
      flyTex.dispose();
      scene.traverse((o: THREE.Object3D) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mm = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
        else mm?.dispose();
      });
      el.removeChild(renderer.domElement);
    };
  }, [fluid]);

  return (
    <section className={s.section} ref={sectionRef}>
      <div className={s.stage}>
        <div ref={hostRef} className={s.canvas} />
        {/* Tytuł widoczny jest obiektem w scenie WebGL (patrz TITLE). Ten h1
            jest tylko dla czytników ekranu i wyszukiwarek – canvas jest
            dla nich pusty. */}
        <h1 className="sr-only">{TITLE.text}</h1>
        {/* Podpisy przy drzewie – timing w CAPTIONS, kolejność ta sama. */}
        <div
          className={`${s.caption} ${s.captionLeft}`}
          ref={(n) => { captionRefs.current[0] = n; }}
        >
          <p>Cześć, jestem Magda. Wygląda na to, że trafiłeś na moje portfolio.</p>
        </div>
        <div
          className={`${s.caption} ${s.captionRight}`}
          ref={(n) => { captionRefs.current[1] = n; }}
        >
          <p>Poznaj mnie i moje projekty. Zainspiruj się — albo zaproś mnie do współpracy.</p>
        </div>
        <div className={s.copy} ref={copyRef}>
          <h2>Lorem ipsum dolor</h2>
          <p>
            Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad
            minim veniam, quis nostrud exercitation.
          </p>
        </div>
      </div>
    </section>
  );
}

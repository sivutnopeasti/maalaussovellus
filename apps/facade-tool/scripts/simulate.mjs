// Simulaatio: testaa koko mittauslogiikka ilman selainta.
//
// Käytetään muutamaa konkreettista skenaariota:
//   1) Pitkä sivu (suorakaide), tunnetuilla mitoilla
//   2) Pääty (harjakatto), tunnetuilla mitoilla
//   3) Kaksi kuvaa, automaattinen referenssi (auto-mode)
//   4) Reunatapaukset (ei pystyreunoja, virheellinen polygoni)
//   5) Pystyperspektiivi (keystone-korjaus) yksinkertaisella kallistuksella
//
// Ajetaan: node scripts/simulate.mjs

// ────────────────────────────────────────────────────────────────────────────
// Toistetaan lib/wallHeight.ts -funktiot puhtaalla JS:llä (samat raja-arvot)
// ────────────────────────────────────────────────────────────────────────────

const VERTICAL_TOLERANCE_DEG = 22;
const MIN_EDGE_PIXELS = 30;

function findVerticalEdges(polygon) {
  const edges = [];
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const pixelLength = Math.sqrt(dx * dx + dy * dy);
    if (pixelLength < MIN_EDGE_PIXELS) continue;
    const deviationDeg =
      Math.atan2(Math.abs(dx), Math.abs(dy)) * (180 / Math.PI);
    if (deviationDeg <= VERTICAL_TOLERANCE_DEG) {
      edges.push({ p1: a, p2: b, pixelLength, deviationDeg });
    }
  }
  return edges;
}

function estimateWallHeightM(polygon, pixelsPerMeter) {
  if (pixelsPerMeter <= 0) return null;
  const edges = findVerticalEdges(polygon);
  if (edges.length === 0) return null;
  const sorted = edges.map((e) => e.pixelLength).sort((a, b) => a - b);
  const m = sorted.length;
  const median =
    m % 2 === 0
      ? (sorted[m / 2 - 1] + sorted[m / 2]) / 2
      : sorted[Math.floor(m / 2)];
  return median / pixelsPerMeter;
}

function findReferenceVerticalEdge(polygon) {
  const edges = findVerticalEdges(polygon);
  if (edges.length === 0) return null;
  return edges.reduce((best, e) =>
    e.pixelLength >= best.pixelLength ? e : best,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Polygonin ala (Shoelace)
// ────────────────────────────────────────────────────────────────────────────

function shoelacePixelArea(polygon) {
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i].x * polygon[j].y;
    area -= polygon[j].x * polygon[i].y;
  }
  return Math.abs(area) / 2;
}

// ────────────────────────────────────────────────────────────────────────────
// Yksinkertainen mittauksen simulaatio (ei keystonea)
// ────────────────────────────────────────────────────────────────────────────

function calculatePolygonAreaM2(polygon, pixelsPerMeter) {
  const px = shoelacePixelArea(polygon);
  return px / (pixelsPerMeter * pixelsPerMeter);
}

// Auto-tila: johda ppm polygonin pisimmästä pystyreunasta + tallennetusta
// nurkkakorkeudesta, ja laske ala
function calculateAutoArea(polygon, storedWallHeightM) {
  const edge = findReferenceVerticalEdge(polygon);
  if (!edge) {
    return { error: "Ei pystyreunoja polygonissa" };
  }
  const ppm = edge.pixelLength / storedWallHeightM;
  const areaM2 = calculatePolygonAreaM2(polygon, ppm);
  return { ppm, areaM2, referencePixelLength: edge.pixelLength };
}

// ────────────────────────────────────────────────────────────────────────────
// Keystone-korjaus: per-rivi paino kun kuva on otettu alaviistosta
// ────────────────────────────────────────────────────────────────────────────

const ASSUMED_FOCAL_RATIO = 0.85;

/**
 * Approksimoi polygonin alan keystone-painotuksella ilman canvasia.
 * Käytetään yksinkertaistettua trapezoidi-integrointia per skannauslinja:
 * jokaiselle riville lasketaan polygonin pikselien lukumäärä ja painotetaan.
 */
function calculatePolygonAreaWithKeystone({
  polygon,
  pixelsPerMeter,
  referenceY,
  imageWidth,
  imageHeight,
  betaDeg,
}) {
  if (Math.abs(betaDeg) < 0.5) {
    return {
      areaM2: calculatePolygonAreaM2(polygon, pixelsPerMeter),
      keystoneFactor: 1,
    };
  }

  const cy = imageHeight / 2;
  const f = ASSUMED_FOCAL_RATIO * imageHeight;
  const tanB = Math.tan((Math.abs(betaDeg) * Math.PI) / 180);
  const vyOffset = (betaDeg > 0 ? -1 : 1) * (f / tanB);
  const vRefOffset = referenceY - cy;
  const cosBeta =
    Math.abs(vyOffset) / Math.sqrt(vyOffset * vyOffset + f * f);
  const refDenom = vyOffset - vRefOffset;

  // Polygonin pikselit per skannausrivi: count(y) = monikulmion leveys rivillä y
  // Käytetään pikselien laskentaan polygonin sisällä olemista (yksinkertainen
  // even-odd-testi joka skannauslinjalla).
  let rawPixels = 0;
  let weightedPixels = 0;
  const STRIDE = 1;

  for (let y = 0; y < imageHeight; y += STRIDE) {
    const inters = [];
    const n = polygon.length;
    for (let i = 0; i < n; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % n];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        const t = (y - a.y) / (b.y - a.y);
        inters.push(a.x + t * (b.x - a.x));
      }
    }
    inters.sort((p, q) => p - q);
    let rowCount = 0;
    for (let i = 0; i + 1 < inters.length; i += 2) {
      rowCount += Math.max(0, Math.min(imageWidth, inters[i + 1]) - Math.max(0, inters[i]));
    }
    const v = y - cy;
    const denom = vyOffset - v;
    if (Math.abs(denom) < 1) continue;
    const ratio = refDenom / denom;
    const weight = ratio * ratio * ratio;
    rawPixels += rowCount;
    weightedPixels += weight * rowCount;
  }

  weightedPixels /= cosBeta;
  const areaPx = weightedPixels;
  const areaM2 = areaPx / (pixelsPerMeter * pixelsPerMeter);
  return {
    areaM2,
    keystoneFactor: rawPixels > 0 ? weightedPixels / rawPixels : 1,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Testirunko
// ────────────────────────────────────────────────────────────────────────────

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function approxEqual(actual, expected, tolerance = 0.05) {
  const diff = Math.abs(actual - expected);
  const rel = expected !== 0 ? diff / Math.abs(expected) : diff;
  return rel <= tolerance;
}

function assertApproxEqual(label, actual, expected, tolerance = 0.05) {
  if (approxEqual(actual, expected, tolerance)) {
    console.log(
      `   ✓ ${label}: ${actual.toFixed(3)} ≈ ${expected.toFixed(3)} (±${(tolerance * 100).toFixed(1)}%)`,
    );
    return true;
  } else {
    console.log(
      `   ✗ ${label}: ${actual.toFixed(3)} ≠ ${expected.toFixed(3)} (poikkeama ${(((actual - expected) / expected) * 100).toFixed(1)}%)`,
    );
    return false;
  }
}

function assertTrue(label, cond) {
  if (cond) {
    console.log(`   ✓ ${label}`);
    return true;
  } else {
    console.log(`   ✗ ${label}`);
    return false;
  }
}

function assertEqual(label, actual, expected) {
  if (actual === expected) {
    console.log(`   ✓ ${label}: ${actual}`);
    return true;
  } else {
    console.log(`   ✗ ${label}: sai ${actual}, odotettu ${expected}`);
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// SKENAARIOT
// ────────────────────────────────────────────────────────────────────────────

test("1. Pitkä sivu — suorakaide, vaaka-referenssi (ulko-ovi 0,9 m)", () => {
  // Talo: pitkä sivu 12,0 m × 3,6 m korkea
  // Kuvan koko 2000 × 1500 px, talo täyttää 80% leveydestä
  // → seinä kuvassa: 1600 px leveä, 480 px korkea
  // Referenssi: ulko-ovi 0,9 m → 120 px
  // → ppm = 120 / 0.9 = 133,33 px/m
  // → odotettu ala = 12,0 × 3,6 = 43,2 m²

  const polygon = [
    { x: 200, y: 510 }, // alas vasen
    { x: 1800, y: 510 }, // alas oikea
    { x: 1800, y: 990 }, // ei käytössä; muutetaan järjestys
  ];
  // korjataan järjestys: alkaen vasen-alanurkasta myötäpäivään
  const longSidePolygon = [
    { x: 200, y: 990 }, // alavasen (sokkelin alareuna)
    { x: 200, y: 510 }, // ylävasen (räystäs)
    { x: 1800, y: 510 }, // yläoikea
    { x: 1800, y: 990 }, // alaoikea
  ];

  const referencePixelDistance = 120; // 0,9 m
  const referenceMeters = 0.9;
  const ppm = referencePixelDistance / referenceMeters;

  const areaM2 = calculatePolygonAreaM2(longSidePolygon, ppm);
  const wallHeight = estimateWallHeightM(longSidePolygon, ppm);
  const verticalEdges = findVerticalEdges(longSidePolygon);

  let ok = true;
  ok &= assertEqual("Pystyreunoja löytyi", verticalEdges.length, 2);
  ok &= assertApproxEqual("Pinta-ala", areaM2, 43.2, 0.02);
  ok &= assertApproxEqual("Nurkkakorkeus", wallHeight, 3.6, 0.02);
  return !!ok;
});

test("2. Pääty — harjakatto, vaaka-referenssi sokkelista", () => {
  // Pääty: leveys 7,0 m, sivun korkeus 3,6 m, harja 6,0 m (= 2,4 m räystään yli)
  // ppm = 100
  // → leveys 700 px, sokkeli y=800, räystäs y=440 (360 px = 3,6 m),
  //   harja y=200 (240 px räystäästä = 2,4 m)
  const ppm = 100;
  const gablePolygon = [
    { x: 100, y: 800 }, // alavasen sokkeli
    { x: 100, y: 440 }, // räystäs vasen
    { x: 450, y: 200 }, // harja keskellä
    { x: 800, y: 440 }, // räystäs oikea
    { x: 800, y: 800 }, // alaoikea sokkeli
  ];

  const areaM2 = calculatePolygonAreaM2(gablePolygon, ppm);
  // Suorakaide: 7,0 × 3,6 = 25,2 m²
  // Kolmio:    7,0 × 2,4 / 2 = 8,4 m²
  // Yhteensä: 33,6 m²
  const expectedArea = 25.2 + 8.4;

  const verticalEdges = findVerticalEdges(gablePolygon);
  const wallHeight = estimateWallHeightM(gablePolygon, ppm);

  let ok = true;
  ok &= assertEqual(
    "Pystyreunoja löytyi (vain seinänurkat, ei harjakatto)",
    verticalEdges.length,
    2,
  );
  ok &= assertApproxEqual("Pinta-ala (sis. harjakolmio)", areaM2, expectedArea, 0.02);
  ok &= assertApproxEqual("Nurkkakorkeus (seinän pystysivut)", wallHeight, 3.6, 0.02);
  return !!ok;
});

test("3. Kahden kuvan työnkulku: auto-referenssi toiselle kuvalle", () => {
  // KUVA 1: pääty 7 m × 3,6 m + harja 6 m, ppm = 100, nurkkakorkeus = 3,6 m
  const photo1Polygon = [
    { x: 100, y: 800 },
    { x: 100, y: 440 },
    { x: 450, y: 200 },
    { x: 800, y: 440 },
    { x: 800, y: 800 },
  ];
  const photo1Ppm = 100;
  const photo1Area = calculatePolygonAreaM2(photo1Polygon, photo1Ppm);
  const storedHeight = estimateWallHeightM(photo1Polygon, photo1Ppm);

  console.log(
    `   ℹ Kuva 1: ala = ${photo1Area.toFixed(2)} m², tallennettu nurkkakorkeus = ${storedHeight.toFixed(2)} m`,
  );

  // KUVA 2: pitkä sivu OTETTU ERI ETÄISYYDELTÄ → eri pikseliskaala
  // Talon mitat 12,0 × 3,6 m, mutta kuvassa esim. 2400 × 720 px → ppm = 200
  // Tämä on toisen kuvan TODELLINEN ppm — mutta käyttäjä ei syötä sitä,
  // vaan se johdetaan automaattisesti polygonin pystyreunasta + storedHeight
  const photo2Polygon = [
    { x: 100, y: 1000 }, // sokkeli alavasen
    { x: 100, y: 280 }, // räystäs vasen (3,6 m × 200 px/m = 720 px korkea)
    { x: 2500, y: 280 }, // räystäs oikea
    { x: 2500, y: 1000 }, // sokkeli alaoikea
  ];
  const photo2TrueppM = 200; // mitä käyttäjän pitäisi saada

  const auto = calculateAutoArea(photo2Polygon, storedHeight);

  let ok = true;
  ok &= assertTrue("Auto-laskenta onnistui", !auto.error);
  if (!auto.error) {
    ok &= assertApproxEqual("Auto-johdettu ppm", auto.ppm, photo2TrueppM, 0.02);
    // Pitkä sivu: 12,0 × 3,6 = 43,2 m²
    ok &= assertApproxEqual("Auto-laskettu ala (pitkä sivu)", auto.areaM2, 43.2, 0.03);
  }
  return !!ok;
});

test("4. Reunatapaus: polygonissa ei pystyreunoja → autovirhe", () => {
  // Vino paralleeligrammi — kaikki reunat selvästi yli 22° pystystä
  const slantedPolygon = [
    { x: 100, y: 800 }, // 1→2: dx=400, dy=-600 → atan(400/600)≈33,7° (vino)
    { x: 500, y: 200 },
    { x: 1700, y: 100 }, // 2→3: vaakatasoinen
    { x: 1300, y: 700 }, // 3→4: dx=-400, dy=600 → 33,7° (vino)
  ];
  const result = calculateAutoArea(slantedPolygon, 3.6);
  return assertTrue("Auto-virhe palautetaan", !!result.error);
});

test("5. Reunatapaus: kolmio jossa vain yksi pystyreuna", () => {
  // Vain yksi pystysivu (esim. käyttäjä on piirtänyt vain osan talosta)
  const triangle = [
    { x: 100, y: 800 },
    { x: 100, y: 200 }, // pysty
    { x: 900, y: 800 },
  ];
  const edges = findVerticalEdges(triangle);
  const ok = assertEqual("Yksi pystyreuna löytyy", edges.length, 1);
  // Yhden pystyreunan medianista saa silti mitan
  const h = estimateWallHeightM(triangle, 100);
  return ok && assertApproxEqual("Korkeus yhdestä reunasta", h, 6.0, 0.02);
});

test("6. ±22° toleranssi: hieman vino reuna hyväksytään", () => {
  // Lievä vinous (10° pystystä) — pitäisi hyväksyä
  const slightlyTilted = [
    { x: 100, y: 800 },
    { x: 100 + 70, y: 800 - 400 }, // 70 px sivuun, 400 px ylös → atan(70/400) ≈ 9,9°
    { x: 1000, y: 200 },
    { x: 900, y: 800 },
  ];
  const edges = findVerticalEdges(slightlyTilted);
  return assertTrue("Lievästi vino pystyreuna hyväksytty", edges.length >= 1);
});

test("7. ±22° toleranssi: liian vinot reunat hylätään", () => {
  // Polygoni jossa KAIKKI sivut > 22° pystystä.
  const tooTilted = [
    { x: 100, y: 800 }, // 1. reuna 1→2: dx=250, dy=-400 → atan(250/400) ≈ 32° (hylätään)
    { x: 350, y: 400 },
    { x: 900, y: 200 }, // 2. reuna 2→3: dx=550, dy=-200 → ≈70° (vaaka)
    { x: 1150, y: 700 }, // 3. reuna 3→4: dx=250, dy=500 → ≈26,6° (hylätään)
    // 4. reuna 4→1: dx=-1050, dy=100 → ≈84° (vaaka)
  ];
  const edges = findVerticalEdges(tooTilted);
  const verticalsFound = edges.length;
  return assertTrue(
    `Kaikki vinot reunat hylätty (löytyi ${verticalsFound} pysty)`,
    verticalsFound === 0,
  );
});

test("8. Pystyperspektiivi (keystone): puhelin kallistettu 10° ylös", () => {
  // Kuvan koko 1600 × 1500 px
  // Talo: 10 m × 5 m korkea, kuvan keskellä
  // Kun puhelin on kallistettu ylös 10°, harja näkyy pienempänä kuin sokkeli
  // → ilman korjausta ala olisi liian pieni; korjauksen pitäisi palauttaa
  //    todellinen ala n. 50 m²

  const imageWidth = 1600;
  const imageHeight = 1500;
  // Idealisoitu kuva: sokkeli y=1200, räystäs y=200 (1000 px korkea kuva-ala)
  // Referenssi otetaan sokkelista (y=1200) → ppm = 1000 / 5 = 200
  const polygon = [
    { x: 300, y: 1200 },
    { x: 300, y: 200 },
    { x: 1300, y: 200 },
    { x: 1300, y: 1200 },
  ];
  const ppm = 200;
  const referenceY = 1200;

  // Ilman korjausta:
  const noCorrection = calculatePolygonAreaM2(polygon, ppm);

  // 10° kallistuksella:
  const withCorrection = calculatePolygonAreaWithKeystone({
    polygon,
    pixelsPerMeter: ppm,
    referenceY,
    imageWidth,
    imageHeight,
    betaDeg: 10,
  });

  console.log(
    `   ℹ Ilman korjausta: ${noCorrection.toFixed(2)} m², 10°-korjauksella: ${withCorrection.areaM2.toFixed(2)} m² (kerroin ${withCorrection.keystoneFactor.toFixed(3)})`,
  );

  let ok = true;
  // Ilman korjausta saadaan polygonin kuva-ala "sellaisenaan" (= 25 m²)
  // Mutta tämä on liian PIENI: oikea seinä on 50 m².
  // Keystone-korjauksen pitäisi nostaa arvoa lähemmäs 50 m².
  ok &= assertTrue(
    "Keystone-kerroin > 1 (yläosaa skaalataan ylöspäin)",
    withCorrection.keystoneFactor > 1.2,
  );
  // Eli korjattu ala on selvästi suurempi kuin korjaamaton
  ok &= assertTrue(
    "Korjattu ala > korjaamaton ala",
    withCorrection.areaM2 > noCorrection * 1.2,
  );
  return !!ok;
});

test("9. Keystone-korjaus: nolla-kallistus ei muuta tulosta", () => {
  const polygon = [
    { x: 300, y: 1200 },
    { x: 300, y: 200 },
    { x: 1300, y: 200 },
    { x: 1300, y: 1200 },
  ];
  const baseline = calculatePolygonAreaM2(polygon, 200);
  const withZero = calculatePolygonAreaWithKeystone({
    polygon,
    pixelsPerMeter: 200,
    referenceY: 1200,
    imageWidth: 1600,
    imageHeight: 1500,
    betaDeg: 0.1,
  });
  return assertApproxEqual(
    "0°-kallistus = ei korjausta",
    withZero.areaM2,
    baseline,
    0.01,
  );
});

test("10. Reaaliaikainen ppm: auto-tilan polygonin pystyreuna → metripituudet", () => {
  // Käyttäjä klikkaa kuva 2:n nurkat. Auto-tilassa ppm johdetaan
  // pisimmästä pystyreunasta. Tarkista että johdettu ppm on identtinen
  // sen kanssa minkä saa kun referenssi piirretään käsin.
  //
  // Kuva 2: pitkä sivu 12 m × 3,6 m, otettu eri etäisyydeltä
  // → todellinen ppm = 220 (vapaa valinta)
  // → seinän korkeus pikselissä = 3,6 × 220 = 792 px
  // → nurkkakorkeus (kuva 1:stä tallennettu) = 3,6 m

  const truePpm = 220;
  // 12,0 m leveys = 2640 px; 3,6 m korkeus = 792 px
  const polygon = [
    { x: 100, y: 1000 }, // sokkeli alavasen
    { x: 100, y: 1000 - 792 }, // räystäs vasen (3,6 m)
    { x: 100 + 2640, y: 1000 - 792 }, // räystäs oikea
    { x: 100 + 2640, y: 1000 }, // sokkeli alaoikea
  ];
  const storedHeightM = 3.6;

  // PolygonSelectin live-laskenta: findReferenceVerticalEdge palauttaa pisimmän
  // pystyreunan; sen pituudesta jaettuna storedHeightM saadaan ppm.
  const edge = findReferenceVerticalEdge(polygon);
  if (!edge) return assertTrue("pystyreuna löytyy", false);

  const derivedPpm = edge.pixelLength / storedHeightM;

  console.log(
    `   ℹ Pystyreunan pituus: ${edge.pixelLength.toFixed(0)} px`,
  );
  console.log(`   ℹ Johdettu ppm: ${derivedPpm.toFixed(2)}`);

  // Esimerkkimitat reaaliaikaisesti näytettäviksi:
  const wallTop = polygon[1];
  const wallBottom = polygon[0];
  const cornerHeightMeters =
    Math.sqrt(
      (wallTop.x - wallBottom.x) ** 2 + (wallTop.y - wallBottom.y) ** 2,
    ) / derivedPpm;

  const eaveLeft = polygon[1];
  const eaveRight = polygon[2];
  const eaveLengthMeters =
    Math.sqrt(
      (eaveRight.x - eaveLeft.x) ** 2 + (eaveRight.y - eaveLeft.y) ** 2,
    ) / derivedPpm;

  console.log(
    `   ℹ Pystysegmentin näytetty pituus: ${cornerHeightMeters.toFixed(2)} m`,
  );
  console.log(
    `   ℹ Räystäs (vaaka) näytetty pituus: ${eaveLengthMeters.toFixed(2)} m`,
  );

  let ok = true;
  ok &= assertApproxEqual("Johdettu ppm ≈ todellinen ppm", derivedPpm, truePpm, 0.01);
  ok &= assertApproxEqual("Pystysegmentti = tallennettu nurkkakorkeus", cornerHeightMeters, 3.6, 0.01);
  ok &= assertApproxEqual("Räystään pituus = oikea 12 m", eaveLengthMeters, 12.0, 0.02);
  return !!ok;
});

test("11. Vertailu: realistinen pieni talo, kahden kuvan ala", () => {
  // Realistinen omakotitalo:
  //   pitkä sivu: 12,0 m × 3,6 m = 43,2 m²
  //   pääty (harja 6,0 m): 7,0 × 3,6 + 7,0 × 2,4 / 2 = 25,2 + 8,4 = 33,6 m²
  //   kokonaisala (yksi pitkä + yksi pääty) = 76,8 m²
  //   x2 vastakkaiset seinät = 153,6 m²

  // KUVA 1: pääty 7 m × 3,6 m + harja 6 m, referenssi sokkelista 1,0 m
  const gablePolygon = [
    { x: 100, y: 800 },
    { x: 100, y: 440 },
    { x: 450, y: 200 },
    { x: 800, y: 440 },
    { x: 800, y: 800 },
  ];
  const gableRefPx = 100; // 1 m
  const gableRefM = 1.0;
  const gablePpm = gableRefPx / gableRefM;
  const gableArea = calculatePolygonAreaM2(gablePolygon, gablePpm);
  const storedHeight = estimateWallHeightM(gablePolygon, gablePpm);

  // KUVA 2: pitkä sivu, AUTO
  const longPolygon = [
    { x: 100, y: 1000 },
    { x: 100, y: 280 },
    { x: 2500, y: 280 },
    { x: 2500, y: 1000 },
  ];
  const auto = calculateAutoArea(longPolygon, storedHeight);

  const oneSetOfWalls = gableArea + auto.areaM2;
  const total = oneSetOfWalls * 2;

  console.log(`   ℹ Pääty: ${gableArea.toFixed(2)} m²`);
  console.log(`   ℹ Pitkä sivu (auto): ${auto.areaM2.toFixed(2)} m²`);
  console.log(`   ℹ Yhden sarjan seinät: ${oneSetOfWalls.toFixed(2)} m²`);
  console.log(`   ℹ Koko talo (×2): ${total.toFixed(2)} m²`);

  let ok = true;
  ok &= assertApproxEqual("Pääty (33,6 m²)", gableArea, 33.6, 0.02);
  ok &= assertApproxEqual("Pitkä sivu (43,2 m²)", auto.areaM2, 43.2, 0.03);
  ok &= assertApproxEqual("Koko talo (153,6 m²)", total, 153.6, 0.03);
  return !!ok;
});

// ────────────────────────────────────────────────────────────────────────────
// MLSD-snap simulaatio (lib/lineSnap.ts logiikka)
// ────────────────────────────────────────────────────────────────────────────

/** Tuotetaan synteettinen viivakartta jossa on suorakulmainen "talon nurkka"
 *  (kaksi viivaa joiden risteyksessä on oikea nurkka). */
function buildSyntheticLineMap(w, h, lines) {
  const mask = new Uint8Array(w * h);
  for (const [x1, y1, x2, y2] of lines) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.round(x1 + dx * t);
      const y = Math.round(y1 + dy * t);
      if (x >= 0 && x < w && y >= 0 && y < h) mask[y * w + x] = 1;
    }
  }
  return { width: w, height: h, mask };
}

function snapToNearestLine(point, lineMap, maxRadiusPx, scaleX = 1, scaleY = scaleX) {
  const { width: w, height: h, mask } = lineMap;
  const cx = Math.round(point.x * scaleX);
  const cy = Math.round(point.y * scaleY);
  const r = Math.max(1, Math.round(maxRadiusPx * Math.min(scaleX, scaleY)));

  if (cx >= 0 && cx < w && cy >= 0 && cy < h && mask[cy * w + cx]) {
    return { x: cx / scaleX, y: cy / scaleY };
  }

  let bestDist2 = Infinity;
  let bestX = -1;
  let bestY = -1;
  let foundShellRadius = -1;

  for (let shell = 1; shell <= r; shell++) {
    if (foundShellRadius > 0 && shell > foundShellRadius * Math.SQRT2 + 1)
      break;
    const x0 = Math.max(0, cx - shell);
    const x1 = Math.min(w - 1, cx + shell);
    const y0 = Math.max(0, cy - shell);
    const y1 = Math.min(h - 1, cy + shell);

    for (const y of [cy - shell, cy + shell]) {
      if (y < 0 || y >= h) continue;
      for (let x = x0; x <= x1; x++) {
        if (mask[y * w + x]) {
          const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
          if (d2 < bestDist2) {
            bestDist2 = d2;
            bestX = x;
            bestY = y;
            if (foundShellRadius < 0) foundShellRadius = shell;
          }
        }
      }
    }
    for (const x of [cx - shell, cx + shell]) {
      if (x < 0 || x >= w) continue;
      for (let y = y0 + 1; y <= y1 - 1; y++) {
        if (mask[y * w + x]) {
          const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
          if (d2 < bestDist2) {
            bestDist2 = d2;
            bestX = x;
            bestY = y;
            if (foundShellRadius < 0) foundShellRadius = shell;
          }
        }
      }
    }
  }

  if (bestX < 0) return null;
  return { x: bestX / scaleX, y: bestY / scaleY };
}

test("12. Line snap — klikkaus siirtyy lähimmälle viivapikselille", () => {
  // Pystyviiva x=500 (täysi korkeus). Vaakaviiva y=300 (täysi leveys).
  const W = 1000;
  const H = 600;
  const lineMap = buildSyntheticLineMap(W, H, [
    [500, 0, 500, H - 1],
    [0, 300, W - 1, 300],
  ]);

  // Klikkaus 2 px sivussa pystyviivasta ja 10 px alaspäin vaakaviivasta:
  // pystyviiva on selvästi lähempänä → snäppäys pystyviivalle.
  const click = { x: 502, y: 310 };
  const snap = snapToNearestLine(click, lineMap, 40);

  console.log(`   ℹ Klikkaus: (${click.x},${click.y})`);
  console.log(`   ℹ Snap: (${snap?.x},${snap?.y})`);
  if (!snap) return false;

  // Pystyviivalla x = 500, lähin y = 310 → d=2
  const ok1 = assertApproxEqual("Snap-x ≈ 500 (pystyviiva)", snap.x, 500, 0.001);
  const ok2 = assertApproxEqual("Snap-y ≈ 310 (säilyy)", snap.y, 310, 0.001);
  return ok1 && ok2;
});

test("13. Line snap — kaukainen klikkaus ei snäppää", () => {
  const W = 1000;
  const H = 600;
  const lineMap = buildSyntheticLineMap(W, H, [
    [500, 0, 500, H - 1],
  ]);

  // Klikkaus 100 px sivussa viivasta, snäppäysraja 40 px → ei snäppää.
  const click = { x: 600, y: 300 };
  const snap = snapToNearestLine(click, lineMap, 40);
  console.log(`   ℹ Klikkaus 100 px viivasta, snap = ${snap ? "siirtyi" : "null"}`);
  return assertTrue("Snap palautti null", snap === null);
});

test("14. Line snap — eri resoluution viivakartta (sama aspect ratio)", () => {
  // Viivakartta 500×300 (puolet alkuperäisen 1000×600:sta).
  const W = 500;
  const H = 300;
  const lineMap = buildSyntheticLineMap(W, H, [
    [250, 0, 250, H - 1], // = x=500 alkuperäisessä koordinaatistossa
  ]);

  // Käyttäjän klikkaus alkuperäiskoordinaatistossa lähellä viivaa
  const click = { x: 510, y: 200 };
  const snap = snapToNearestLine(click, lineMap, 40, W / 1000, H / 600);
  console.log(`   ℹ Klikkaus (510,200) alkuperäiskoordinaatistossa → snap (${snap?.x},${snap?.y})`);
  if (!snap) return false;
  // Snäppäys siirtää x ≈ 500 (puolet pikseleistä lineMapissa = 250 → /scale = 500)
  return assertApproxEqual("Snap x ≈ 500 alkuperäiskoordinaatistossa", snap.x, 500, 0.01);
});

test("15. Line snap — anamorfinen venytys (4032×3024 → 1024×1024)", () => {
  // Simuloidaan Fal MLSD:n käyttäytymistä: portrait-iPhone-kuva
  // venytetään 1024×1024-neliöön. Pystyviiva alkuperäisen kuvan
  // x=2000 sijoittuu lineMapissa x = 2000 * 1024/4032 ≈ 508.
  const sourceW = 4032;
  const sourceH = 3024;
  const lmW = 1024;
  const lmH = 1024;
  const lmX = Math.round(2000 * (lmW / sourceW));
  const lineMap = buildSyntheticLineMap(lmW, lmH, [
    [lmX, 0, lmX, lmH - 1], // pystyviiva line-map-koordinaatistossa
  ]);

  // Klikkaus alkuperäisessä koordinaatistossa: 30 px pielessä pystyviivasta
  const click = { x: 2030, y: 1500 };
  const radius = Math.hypot(sourceW, sourceH) * 0.03; // ≈ 151 px source-pikseliä
  const snap = snapToNearestLine(
    click,
    lineMap,
    radius,
    lmW / sourceW,
    lmH / sourceH,
  );
  console.log(`   ℹ Klikkaus (2030,1500) → snap (${snap?.x.toFixed(0)},${snap?.y.toFixed(0)})`);
  console.log(`   ℹ Snäppäysraja: ${radius.toFixed(0)} px alkuperäisessä`);
  if (!snap) return false;
  // Snap pitäisi siirtää x ≈ 2000, y säilyy ≈ 1500 (skaalaus epäsuhtainen
  // mutta tulos palautetaan alkuperäiseen koordinaatistoon)
  const ok1 = assertApproxEqual("Snap x ≈ 2000", snap.x, 2000, 0.01);
  const ok2 = assertApproxEqual("Snap y ≈ 1500", snap.y, 1500, 0.02);
  return ok1 && ok2;
});

// ────────────────────────────────────────────────────────────────────────────
// AJO
// ────────────────────────────────────────────────────────────────────────────

console.log("\n════════════════════════════════════════════════════════════");
console.log("  FACADE-TOOL — Mittauslogiikan simulaatio");
console.log("════════════════════════════════════════════════════════════\n");

for (const t of tests) {
  console.log(`▸ ${t.name}`);
  try {
    const result = t.fn();
    if (result) {
      passed++;
      console.log(`   → LÄPI\n`);
    } else {
      failed++;
      console.log(`   → EPÄONNISTUI\n`);
    }
  } catch (err) {
    failed++;
    console.log(`   ✗ POIKKEUS: ${err.message}\n`);
  }
}

console.log("════════════════════════════════════════════════════════════");
console.log(`  Tulos: ${passed}/${tests.length} läpi, ${failed} epäonnistui`);
console.log("════════════════════════════════════════════════════════════\n");

process.exit(failed === 0 ? 0 : 1);

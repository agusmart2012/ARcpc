"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const plan = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/routines/m15.json"), "utf8"));

function names(day) {
  return day.blocks.flatMap((block) => block.exercises.map((exercise) => exercise.name));
}

function findExercise(dayLabel, exerciseName) {
  const day = plan.days.find((item) => item.label === dayLabel);
  assert.ok(day, dayLabel);
  const exercise = day.blocks.flatMap((block) => block.exercises).find((item) => item.name === exerciseName);
  assert.ok(exercise, dayLabel + " / " + exerciseName);
  return exercise;
}

test("M15 trae los cinco días de la planilla, en orden", () => {
  assert.equal(plan.version, 1);
  assert.equal(plan.category, "m15");
  assert.equal(plan.week, "16-20");
  assert.equal(plan.period, "Competitivo");
  assert.deepEqual(plan.days.map((day) => day.label), ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]);
  assert.deepEqual(plan.days.map((day) => day.weekday), [1, 2, 3, 4, 5]);
  assert.deepEqual(plan.days.map((day) => day.session), ["Día 1", "Día 2", "Día 3", "Día 4", "Día 5"]);
});

test("cada día sigue el orden de la planilla", () => {
  assert.deepEqual(names(plan.days[0]), [
    "Foam Roller",
    "Kneeling Glute Stretch",
    "Adductor Stretch",
    "Downward Dog",
    "Crunch cable c/cuerda",
    "Plancha c/disco · Forwards",
    "Plancha c/disco · Backs",
    "Sentadilla Atras c/barra + Multisaltos en \"L\"",
    "Press de Pecho Plano c/barra + Flexiones de Rechazo",
    "Dominadas c/lastre",
    "Vuelos YTW en banco Inclinado + Cuello c/banda",
    "Regenerativo",
    "Estiramiento",
  ]);
  assert.deepEqual(names(plan.days[1]), [
    "Foam Roller",
    "Prisoner Good Morning",
    "Adductor Stretch",
    "Hip Circles",
    "Plate Wraps",
    "Hollow",
    "Press Pallof en polea + Dead Bug",
    "Plancha Copenhage",
    "Peso Muerto c/barra Convencional",
    "Wallking Lunges c/DB + Multisaltos en cuadrado",
    "*Skipping contra pared + *Saltos alternados en banco/cajón",
    "Push Press",
    "Curl de Biceps barra \"Z\"",
    "Farmer Walk Carry",
    "Regenerativo",
    "Estiramiento",
  ]);
  assert.deepEqual(names(plan.days[2]), [
    "Foam Roller",
    "Prisoner Good Morning",
    "Adductor Stretch",
    "Hip Circles",
    "Plate Wraps",
    "Birg Dog",
    "Plancha Lateral · Forwards",
    "Plancha Lateral · Backs",
    "Sentailla en OH",
    "Camilla de Cuadriceps + Camilla Flexora Sentado",
    "Dominadas Comando + Pull Over c/DB",
    "Serrucho (en posición de carrera alta) + Jalones c/banda lucha",
    "Curl de Biceps (toma Prona) + Jalones Polea alta Triceps Soga",
    "Trapecio c/DB + Cuello c/banda",
    "Regenerativo",
    "Estiramiento",
  ]);
  assert.deepEqual(names(plan.days[3]), [
    "Foam Roller",
    "Kneeling Glute Stretch",
    "Adductor Stretch",
    "Downward Dog",
    "Hollow",
    "Press Pallof en polea + Dead Bug",
    "Plancha Copenhage",
    "Sentadilla Frontal c/barra",
    "Prensa",
    "Press Militar (Shouder Press)",
    "Vuelos Laterales c/DB + Vuelos Fronales c/disco (punta de dedos)",
    "Press Frances c/barra",
    "Farmer Walk Carry OH",
    "Regenerativo",
    "Estiramiento",
  ]);
  assert.deepEqual(names(plan.days[4]), [
    "Foam Roller",
    "Prisoner Good Morning",
    "Adductor Stretch",
    "Hip Circles",
    "Plate Wraps",
    "Birg Dog",
    "Plancha Lateral · Forwards",
    "Plancha Lateral · Backs",
    "Remo Tumbado",
    "Jalones Polea Alta (espalda) toma supina",
    "Vuelos Posteriores + Face Pull c/TRX",
    "Press Militar de rodilla c/DB + Halo c/disco",
    "Curl de Biceps Compañero",
    "Flexiones de Cuello c/disco en banco plano",
    "Regenerativo",
    "Estiramiento",
  ]);
});

test("las cargas, pausas y videos quedan en la columna que dice la planilla", () => {
  const sentadilla = findExercise("Lunes", "Sentadilla Atras c/barra + Multisaltos en \"L\"");
  assert.equal(sentadilla.sets, 4);
  assert.equal(sentadilla.reps, "4 - 5");
  assert.equal(sentadilla.intensity, "85%");
  assert.equal(sentadilla.rest, "Pausa 2'–3'");
  assert.match(sentadilla.notes, /3 saltos verticales frontales/);

  const forwards = findExercise("Lunes", "Plancha c/disco · Forwards");
  assert.equal(forwards.sets, 2);
  assert.equal(forwards.reps, "2'");
  assert.equal(forwards.rest, undefined);

  const backs = findExercise("Lunes", "Plancha c/disco · Backs");
  assert.equal(backs.sets, 3);
  assert.equal(backs.reps, "60\"");
  assert.equal(backs.rest, "Pausa 60\"");

  const lunges = findExercise("Martes", "Wallking Lunges c/DB + Multisaltos en cuadrado");
  assert.equal(lunges.sets, 4);
  assert.equal(lunges.reps, "15 + 3");
  assert.equal(lunges.intensity, "60\"");
  assert.equal(lunges.rest, "Micropausa 90\"");

  const skipping = findExercise("Martes", "*Skipping contra pared + *Saltos alternados en banco/cajón");
  assert.equal(skipping.reps, "3 c/l + 8c/l");
  assert.equal(skipping.rest, "Micropausa 90\"");
  assert.deepEqual(skipping.videos.map((video) => video.url), [
    "https://www.youtube.com/watch?v=dMzBl97BuHk",
    "https://www.youtube.com/shorts/jHWEpZZ9rfQ",
  ]);

  const oh = findExercise("Miércoles", "Sentailla en OH");
  assert.equal(oh.intensity, "20% - 30%");
  assert.equal(oh.videos[0].url, "https://www.youtube.com/watch?v=pn8mqlG0nkE");

  const serrucho = findExercise("Miércoles", "Serrucho (en posición de carrera alta) + Jalones c/banda lucha");
  assert.equal(serrucho.sets, 4);
  assert.equal(serrucho.reps, "8 c/l + 6\"");
  assert.equal(serrucho.rest, "Micropausa 90\"");

  const frontal = findExercise("Jueves", "Sentadilla Frontal c/barra");
  assert.equal(frontal.sets, 4);
  assert.equal(frontal.reps, "6");
  assert.equal(frontal.intensity, "75%");
  assert.equal(frontal.rest, "Micropausa 2'–3'");

  const vuelos = findExercise("Jueves", "Vuelos Laterales c/DB + Vuelos Fronales c/disco (punta de dedos)");
  assert.equal(vuelos.intensity, "RIR 1");
  assert.equal(vuelos.reps, "12 + 12");

  const remo = findExercise("Viernes", "Remo Tumbado");
  assert.equal(remo.intensity, "75%");
  assert.equal(remo.sets, 4);

  const cuello = findExercise("Viernes", "Flexiones de Cuello c/disco en banco plano");
  assert.equal(cuello.videos[0].url, "https://www.youtube.com/shorts/yeV8nEy9nGc");

  const adductorLunes = findExercise("Lunes", "Adductor Stretch");
  assert.equal(adductorLunes.reps, "3×10\"");
  const adductorMartes = findExercise("Martes", "Adductor Stretch");
  assert.equal(adductorMartes.reps, "2×10");
});

test("la movilidad es una sola pasada y cada video es un enlace", () => {
  for (const day of plan.days) {
    const mobility = day.blocks.find((block) => /Elongación/.test(block.title));
    assert.ok(mobility, day.label);
    assert.match(mobility.note, /una sola vez/);
    assert.ok(mobility.exercises.every((exercise) => exercise.check === true));
  }
  const ids = [];
  for (const day of plan.days) {
    for (const block of day.blocks) {
      for (const exercise of block.exercises) {
        ids.push(exercise.id);
        for (const video of exercise.videos || []) assert.match(video.url, /^https:\/\//);
      }
    }
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 76);
  assert.equal(plan.reference.length, 9);
  assert.equal(plan.ranges.length, 4);
});

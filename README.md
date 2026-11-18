# Sala de Alto Rendimiento · Carrasco Polo Club

Rutina de rugby de la sala de alto rendimiento. Hay una pestaña por categoría: M13, M15, M17, M19, PRE-INTER, INTER y PRIMERA. M15 ya trae la planilla Post-Temp A de la semana 47-50, día por día. En el teléfono se marcan las series y se abren los videos de la planilla. El coach responde con Grok, si hay una clave de xAI en esta compu.

## Arrancar

Doble clic en `iniciar.cmd`, o:

```
npm install
npm start
```

En esta compu: http://localhost:4173

En el iPhone, Safari abre la dirección que imprime la consola, la que empieza con `http://192.168…`. La rutina queda guardada en el teléfono. Los videos y el coach necesitan esta compu prendida, en la misma red.

Si el iPhone no entra, cuando Windows pregunte dejá que Node.js use las redes privadas.

## Otra planilla

El botón + carga un Excel o un PDF en la categoría que esté abierta. El resto de las categorías no se toca. Sirve cualquiera de estas formas:

- Una hoja por día: `Lunes`, `Martes`, `Jueves`, o `Lunes - Pecho`.
- Una sola hoja con columna `Día`, o el día escrito en la primera columna de cada fila.
- Los días en columnas: `Lunes | Martes | Jueves`, con los ejercicios debajo de cada uno.
- Columnas `Ejercicio`, `Series`, `Reps` o `Repeticiones`, `Peso`, `Descanso`, `Notas`. Los nombres pueden variar.
- Una lista suelta, una línea por ejercicio: `Sentadilla 5x5 100kg`.
- Un CSV separado por coma o punto y coma.
- Un PDF con texto: una página por día, una tabla o líneas como `Sentadilla 5x5 100kg`. Una foto escaneada no se lee.

Si los días no tienen fecha ni nombre de día de la semana (Push, Pull, Pierna), la app los rota: hoy es el primero y podés saltear.

Hay un ejemplo en la pantalla de inicio y en `public/sample/rutina-ejemplo.xlsx`.

## Coach

La clave no va al teléfono.

1. Creá una en https://console.x.ai
2. Copiá `.env.example` a `.env`
3. Pegá `XAI_API_KEY=...`
4. Reiniciá la app

El modelo es `grok-4.7`.

## Cuentas

La app pide login o registro. Cada cuenta queda en un Excel (`Cuentas` + `Datos`): mail, nombre, clave hasheada y el snapshot de la rutina (categoría, series, kilos, avisos, chat).

En esta compu el archivo es `data/cuentas.xlsx`. En Vercel el disco se borra entre deploys, así que el mismo Excel vive en [Vercel Blob](https://vercel.com/docs/vercel-blob). Con eso entras desde cualquier teléfono y siguen los datos.

1. En Vercel creá un Blob Store (privado) y conectalo al proyecto.
2. Marcá que agregue `BLOB_READ_WRITE_TOKEN`.
3. En Environment Variables poné también `SESSION_SECRET` (una frase larga, 16 caracteres o más).
4. Redeploy.

En local, copiá `.env.example` a `.env` y opcionalmente las mismas claves. Sin Blob, las cuentas quedan en `data/cuentas.xlsx` de esta máquina.

La clave nunca se guarda en texto plano. La sesión es una cookie `httpOnly` de 30 días.

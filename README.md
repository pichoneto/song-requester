# Karaoke Requests

Web estatica para publicar en GitHub Pages un cancionero de karaoke, permitir busqueda por artista o cancion, solicitar temas y mostrar la cola compartida con Firebase.

## Uso local

```powershell
python tools/extract_songs.py cancionero_corregido_avanzado.docx data/songs.json
python -m http.server 8000
```

Despues abre `http://localhost:8000`.

## Firebase

La app usa Firebase Authentication y Cloud Firestore.

- Usuarios publicos: entran con Authentication anonimo.
- Administradores: entran con Email/Password.
- `users/{uid}` guarda el nombre mostrado, `lastRequestAt`, `createdAt` y `lastSeenAt`.
- `requests/{autoId}` guarda cada cancion solicitada.
- `admins/{uid}` autoriza que un usuario de Email/Password gestione la cola.

La pestaña `Administracion` contiene el login de administrador y el QR. Cuando el admin inicia sesion, en la cola aparecen los controles para pasar a la siguiente cancion, poner una cancion concreta ahora y eliminar solicitudes.

Activa en Firebase Console:

1. `Authentication > Sign-in method > Anonymous`.
2. `Authentication > Sign-in method > Email/Password`.
3. `Firestore Database`.

Para crear un administrador:

1. En `Authentication > Users`, crea un usuario con email y contrasena.
2. Copia su `User UID`.
3. En Firestore crea el documento `admins/{UID}`.
4. Anade el campo `isAdmin` de tipo boolean con valor `true`.

Reglas de desarrollo recomendadas para Firestore:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function isAdmin() {
      return signedIn()
        && exists(/databases/$(database)/documents/admins/$(request.auth.uid))
        && get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.isAdmin == true;
    }

    match /admins/{userId} {
      allow read: if signedIn() && request.auth.uid == userId;
      allow write: if false;
    }

    match /users/{userId} {
      allow read, create, update: if signedIn() && request.auth.uid == userId;
    }

    match /requests/{requestId} {
      allow read: if signedIn();
      allow create: if signedIn()
        && request.resource.data.userId == request.auth.uid
        && request.resource.data.status == "queued";
      allow update, delete: if isAdmin();
    }
  }
}
```

Si ves `FirebaseError: Missing or insufficient permissions`, publica temporalmente estas reglas abiertas para usuarios autenticados y confirma que la app funciona:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Cuando funcione, vuelve a las reglas de desarrollo de arriba.

## Publicacion en GitHub Pages

1. Sube estos ficheros a un repositorio de GitHub.
2. En `Settings > Pages`, selecciona la rama principal y la carpeta raiz.
3. Abre la URL publicada y muestra la vista `QR`.

## Creditos

El escudo `assets/escudo-villar-del-olmo.svg` procede de Wikimedia Commons: `Escudo de Villar del Olmo.svg`, obra de SanchoPanzaXXI con ajustes de Asqueladd, publicado bajo licencias CC BY-SA y GFDL. Fuente: https://commons.wikimedia.org/wiki/File:Escudo_de_Villar_del_Olmo.svg

El logo `assets/logo-piltrafa-mark.png` se genero a partir del PDF local `LOGO PILTRAFA_2.pdf`, recortando el fondo negro y dejando el leon claro con el texto en tinta oscura sobre fondo transparente.

## Limitacion importante

GitHub Pages solo sirve ficheros estaticos. Firebase se encarga de la cola compartida. El bloqueo de 10 minutos se aplica en el frontend usando `users/{uid}.lastRequestAt`; para impedir abusos fuertes habria que reforzarlo con Cloud Functions o reglas mas estrictas.

## Actualizar el cancionero

Sustituye el `.docx` y ejecuta de nuevo:

```powershell
python tools/extract_songs.py cancionero_corregido_avanzado.docx data/songs.json
```

🌐 Busuu Helper (v0.1.12)

Busuu Helper est une extension pour navigateurs Chromium (Google Chrome, Brave, Microsoft Edge, Opera) conçue pour assister, automatiser et fluidifier la progression sur la plateforme d'apprentissage de langues Busuu
.

Développée sous Manifest V3, elle combine une détection avancée des réponses (via interception réseau et inspection du DOM) avec un moteur de navigation et d'enchaînement automatique des leçons.

📋 Table des matières
Fonctionnalités clés
Modes de fonctionnement
Types d'exercices pris en charge
Architecture technique
Guide d'installation
Guide d'utilisation
Dépannage et FAQ
Avertissement et éthique
✨ Fonctionnalités clés
Interception réseau discrète et temps réel : Intercepte les messages WebSocket, les requêtes fetch et XMLHttpRequest afin de capturer les réponses exactes issues des API et des flux GraphQL internes de Busuu.
Analyse avancée du DOM & Shadow DOM : Détecte les balises et attributs internes (data-qa-pass, data-correct, identifiants d'entités, etc.) et explore récursivement les arbres Shadow DOM.
Support étendu d'exercices : Gère les choix multiples, les remises en ordre de phrases ou de mots, les textes à trous, la saisie au clavier et les exercices d'écriture pour la communauté.
Enchaînement automatique (Auto-flow) :
Clic automatique sur « Continuer », « Suivant » et les boutons de validation.
Fermeture automatique des dialogues intrusifs (ex. « Non merci »).
Validation automatique des écrans de fin de leçon et des écrans « Défis du jour ».
Démarrage automatique de la leçon suivante depuis le tableau de bord du cours.
Sélection automatique du niveau débutant lors des dialogues de placement CEFR (A1, A2, etc.).
Watchdog anti-blocage : Mécanisme de surveillance interne réinitialisant automatiquement les verrous si une action reste bloquée pendant plus de 3 secondes.
🎛️ Modes de fonctionnement

L'extension se configure via son popup accessible en cliquant sur son icône dans la barre d'outils du navigateur :

Option	Rôle	Comportement
Accord / Consentement	Sécurité obligatoire	Condition préalable indispensable. L'extension ne peut pas être activée sans cette case cochée.
Activer sur busuu.com	Interrupteur général	Active ou désactive l'ensemble de la logique de détection et d'interaction sur les pages Busuu.
Mode semi‑auto (Afficher sans cliquer)	Assistance visuelle	N'effectue aucun clic automatique. Surligne la bonne réponse avec un contour vert et affiche un bandeau d'information. (Incompatible avec le mode délai)
Mode délai (Attendre 20s avant de cliquer)	Pacing réaliste	Marque une pause de 20 secondes avant de sélectionner la réponse, avec décompte visuel en temps réel (Attente: Xs). Simule un rythme d'apprentissage humain. (Incompatible avec le mode semi-auto)
Debug (Overlay diagnostics)	Télémétrie développeur	Affiche une bulle de diagnostic en haut à droite avec l'état des WebSockets, les opérations GraphQL interceptées et les réponses capturées.
🎯 Types d'exercices pris en charge
Type d'exercice	Stratégie de résolution
Choix multiples (QCM)	Correspondance du texte ou résolution des identifiants backend (entity_...) via le dictionnaire de traduction interne.
Vrai / Faux	Détection des valeurs booléennes (true / false) mappées sur les éléments data-qa-exercise-true / data-qa-exercise-false.
Paires et correspondances	Association des éléments correspondants via l'attribut data-qa-pass ou le graphe de correspondances API.
Ordre des mots	Reconstitution de la phrase dans l'ordre syntaxique en cliquant sur les étiquettes correspondantes.
Ordre des lettres	Reconstitution du mot lettre par lettre selon l'index de séquence interne.
Textes à trous (Gap fill)	Détection des mots manquants dans la phrase et sélection des tuiles associées.
Saisie au clavier (Typing)	Détection de la solution, focus du champ et simulation d'une frappe clavier authentique avec événements DOM complets (input, change, keydown).
Verbes à particule (Phrasal verbs)	Clic synchronisé sur le verbe principal et sa particule associée.
Exercice d'écriture communauté	Bascule en mode rédaction, détection du nombre de mots requis, génération de contenu structuré, saisie automatique et envoi via « Envoyer à la communauté ».
🏗️ Architecture technique
├── manifest.json       # Déclaration Manifest V3 (permissions, scripts, correspondances d'URL)
├── background.js       # Service worker initialisant les valeurs par défaut dans le stockage
├── inject.js           # Script injecté dans la page (monkey-patch de fetch, XHR et WebSocket)
├── content.js          # Moteur principal (écouteur réseau, parser DOM, résolution, watchdog)
├── popup.html          # Interface utilisateur du panneau de contrôle
├── popup.js            # Logique du panneau et synchronisation avec chrome.storage.sync
└── popup.css           # Thème sombre moderne pour le panneau de contrôle
Fonctionnement interne
inject.js s'exécute dès le chargement (document_start) directement dans le contexte de la page. Il intercepte les flux window.fetch, window.XMLHttpRequest et window.WebSocket. Lorsqu'un payload JSON est détecté, il le transmet au content script via window.postMessage.
content.js écoute ces messages, explore récursivement les structures de données pour y extraire les réponses (correctAnswer, solution, choices, etc.), alimente un dictionnaire de traduction (str_xxx vers texte clair) et observe les mutations du DOM via un MutationObserver.
Selon le mode configuré, le moteur résout le composant cible dans le DOM, applique un surlignage visuel ou déclenche un clic synthétique et valide l'exercice pour passer à l'étape suivante.
🚀 Guide d'installation
Téléchargez ou clonez ce dossier sur votre machine.
Ouvrez votre navigateur Chromium (ex. Google Chrome, Brave, Microsoft Edge, Opera).
Accédez à la page de gestion des extensions :
Sur Chrome : chrome://extensions/
Sur Brave : brave://extensions/
Sur Edge : edge://extensions/
Activez le Mode développeur (interrupteur en haut à droite).
Cliquez sur Charger le dossier non empaqueté (ou Load unpacked).
Sélectionnez le dossier contenant les fichiers de l'extension (busuu extension v 2.2).
Busuu Helper apparaît désormais dans votre liste. Épinglez-le à votre barre d'outils pour y accéder rapidement.
📖 Guide d'utilisation
1. Première configuration
Rendez-vous sur busuu.com
 et connectez-vous à votre compte.
Cliquez sur l'icône Busuu Helper dans la barre d'outils de votre navigateur.
Cochez impérativement la case de consentement :
Je confirme avoir l'accord de Busuu pour automatiser.
Cochez ensuite l'activation générale :
Activer sur busuu.com.
Le bandeau de statut en bas du popup doit afficher : Actif sur busuu.com.
2. Choix du mode
Automatisation complète : Laissez les options semi-auto et délai décochées pour une résolution rapide et continue.
Assistance à l'apprentissage : Activez le Mode semi-auto pour afficher visuellement les réponses sans clic automatique.
Progression réaliste : Activez le Mode délai (20s) pour marquer une temporisation naturelle de 20 secondes avant chaque réponse.
3. Déroulement des leçons
Démarrez n'importe quelle leçon ou restez sur le tableau de bord : l'extension prend le relais automatiquement.
Pour désactiver ou mettre en pause l'extension à tout moment, ouvrez la popup et décochez Activer sur busuu.com.
🛠️ Dépannage et FAQ
Le statut reste bloqué sur "Inactif"
Veillez à cocher la case de consentement avant d'activer l'extension. Si la case de consentement est décochée, l'activation est automatiquement bloquée par sécurité.
Un exercice ne se valide pas
Ouvrez le popup et activez la case Debug (overlay diagnostics).
Vérifiez en haut à droite de l'écran que les connexions WebSocket et les opérations GraphQL sont bien détectées.
Si un exercice utilise un modèle inédit, actualisez la page (F5) pour relancer l'injection du script réseau.
Le watchdog interne débloque automatiquement les états d'attente prolongés après environ 3 secondes.
Conflit entre les modes
Le Mode semi-auto et le Mode délai sont mutuellement exclusifs : cocher l'un désélectionne automatiquement l'autre.
⚠️ Avertissement et éthique

WARNING

Cette extension est fournie exclusivement à des fins de démonstration technique et éducative autour des technologies web modernes (Manifest V3, manipulation du DOM, injection de scripts et interception réseau).

L'automatisation des exercices peut être en infraction avec les Conditions Générales d'Utilisation de Busuu.
L'utilisation d'outils automatisés prive l'utilisateur de l'apprentissage réel de la langue ciblée.
L'utilisateur assume l'entière responsabilité de l'utilisation de cet outil sur son compte personnel.

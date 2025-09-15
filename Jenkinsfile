// Jenkins Pipeline mit nur einer Stage für SonarQube Analyse
// Voraussetzungen (in Jenkins global konfiguriert):
// 1. SonarQube Server Name: "SonarQube" (anpassen falls anders)
// 2. Tool "SonarScanner" als Global Tool definiert
// 3. (Optional) NodeJS Tool "Node18" – falls nicht vorhanden, npm via System nutzen
// 4. Credential basierter Token im SonarQube Server hinterlegt (Plugin kümmert sich um Injection)
//
// Hinweise:
// - Nur eine Stage wie gewünscht
// - Führt npm ci aus, baut Projekt (Fehler ignoriert, falls Build für Analyse nicht zwingend nötig) und startet Scanner
// - Projektversion = aktueller Commit Hash kurz
// - Falls Coverage genutzt wird: Vorher "npm test -- --coverage" und lcov Pfad in sonar-project.properties sicherstellen

pipeline {
  agent any

  options {
    // ansiColor entfernt (Plugin nicht vorhanden / Fehler in Jenkins)
    timeout(time: 15, unit: 'MINUTES')
  }

  stages {
    stage('SonarQube Analysis') {
      steps {
        checkout scm
        script {
          // Installation Abhängigkeiten (silent / schneller)
          sh 'npm ci --no-audit --no-fund'
          // Optionaler Build – Fehler sollen Analyse nicht komplett verhindern
          sh 'npm run build || echo "Build Fehler ignoriert für Sonar Analyse"'
        }
        withCredentials([string(credentialsId: 'sonar-token', variable: 'SONAR_TOKEN')]) {
          withSonarQubeEnv('SonarQube') {
            sh '''
              set -eux
              SCANNER_VERSION=6.2.1.4610
              # Finde oder installiere sonar-scanner
              if command -v sonar-scanner >/dev/null 2>&1; then
                SCANNER_CMD=sonar-scanner
              elif [ -x ./node_modules/.bin/sonar-scanner ]; then
                SCANNER_CMD=./node_modules/.bin/sonar-scanner
              else
                if [ ! -d .sonar-scanner ]; then
                  echo "Lade SonarScanner ${SCANNER_VERSION}..."
                  if command -v curl >/dev/null 2>&1; then
                    curl -sSL -o sonar-scanner.zip "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-${SCANNER_VERSION}-linux-x64.zip"
                  elif command -v wget >/dev/null 2>&1; then
                    wget -q -O sonar-scanner.zip "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-${SCANNER_VERSION}-linux-x64.zip"
                  else
                    echo "Weder curl noch wget verfügbar." >&2
                    exit 1
                  fi
                  unzip -q sonar-scanner.zip
                  mv sonar-scanner-* .sonar-scanner
                  rm sonar-scanner.zip
                fi
                SCANNER_CMD=$(pwd)/.sonar-scanner/bin/sonar-scanner
              fi
              # Java Check (Scanner benötigt Java 17+)
              if ! java -version >/dev/null 2>&1; then
                echo "Java nicht gefunden. Bitte Java 17 auf dem Agent installieren." >&2
                exit 1
              fi
              GIT_HASH=$(git rev-parse --short HEAD)
              "$SCANNER_CMD" \
                -Dsonar.projectVersion=${GIT_HASH} \
                -Dsonar.login=${SONAR_TOKEN}
            '''
          }
        }
      }
    }
  }

  post {
    failure { echo 'Pipeline fehlgeschlagen.' }
    success { echo 'SonarQube Analyse abgeschlossen.' }
  }
}

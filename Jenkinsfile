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
    ansiColor('xterm')
    timeout(time: 15, unit: 'MINUTES')
  }

  environment {
    SCANNER_HOME = tool 'SonarScanner'
  }

  stages {
    stage('SonarQube') {
      steps {
        checkout scm
        script {
          // Installation Abhängigkeiten (silent / schneller)
          sh 'npm ci --no-audit --no-fund'
          // Optionaler Build – Fehler sollen Analyse nicht komplett verhindern
          sh 'npm run build || echo "Build Fehler ignoriert für Sonar Analyse"'
        }
        withSonarQubeEnv('SonarQube') {
          sh '''
            set -eux
            GIT_HASH=$(git rev-parse --short HEAD)
            $SCANNER_HOME/bin/sonar-scanner \
              -Dsonar.projectVersion=${GIT_HASH}
          '''
        }
      }
    }
  }

  post {
    failure { echo 'Pipeline fehlgeschlagen.' }
    success { echo 'SonarQube Analyse abgeschlossen.' }
  }
}


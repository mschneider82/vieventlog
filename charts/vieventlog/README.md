# ViEventLog Kubernetes Deployment

Kubernetes Manifeste für ViEventLog mit Traefik Ingress und Let's Encrypt TLS.

## Voraussetzungen

- Kubernetes Cluster
- Traefik Ingress Controller
- cert-manager mit `letsencrypt-prod` ClusterIssuer
- kubectl konfiguriert

## Installation

### 1. Secret erstellen

**Option A: Via kubectl (empfohlen)**

```bash
kubectl create secret generic vieventlog-secrets \
  --from-literal=vicare-email='ihre@email.de' \
  --from-literal=vicare-password='ihr-passwort' \
  --from-literal=vicare-client-id='ihre-client-id' \
  --from-literal=vicare-account-name='Mein Haus' \
  --from-literal=basic-auth-user='admin' \
  --from-literal=basic-auth-password='geheim123'
```

**Hinweis:** Das `clientSecret` ist in der Anwendung hardcoded und muss nicht konfiguriert werden.

**Hinweis:** Die Manifeste verwenden keinen hardcodierten Namespace. Deployen Sie mit:
```bash
# Im aktuellen Namespace
kubectl apply -f charts/vieventlog/

# In spezifischem Namespace
kubectl apply -f charts/vieventlog/ -n ihr-namespace
```

**Option B: Via YAML**

```bash
# Werte base64 encodieren
echo -n 'ihre@email.de' | base64

# secret.yaml erstellen (siehe secret.yaml.example)
cp secret.yaml.example secret.yaml
# Editieren und echte base64-Werte eintragen
kubectl apply -f secret.yaml
```

**Wichtig:** `secret.yaml` sollte NICHT in Git committed werden!

### 2. Domain anpassen

Editieren Sie `ingress.yaml` und ersetzen Sie `vieventlog.example.com` mit Ihrer Domain:

```yaml
spec:
  tls:
  - hosts:
    - ihre-domain.de
    secretName: vieventlog-tls
  rules:
  - host: ihre-domain.de
```

### 3. Deployment

```bash
# Im aktuellen Namespace deployen
kubectl apply -f charts/vieventlog/

# Oder in spezifischem Namespace
kubectl apply -f charts/vieventlog/ -n production

# Oder einzeln
kubectl apply -f charts/vieventlog/pvc.yaml
kubectl apply -f charts/vieventlog/deployment.yaml
kubectl apply -f charts/vieventlog/service.yaml
kubectl apply -f charts/vieventlog/ingress.yaml
```

### 4. Status prüfen

```bash
# Pod Status
kubectl get pods -l app=vieventlog

# Logs anzeigen
kubectl logs -l app=vieventlog -f

# Service prüfen
kubectl get svc vieventlog

# Ingress prüfen
kubectl get ingress vieventlog

# Certificate prüfen (cert-manager)
kubectl get certificate vieventlog-tls
kubectl describe certificate vieventlog-tls
```

## Konfiguration

### Multi-Account Setup

Für mehrere Viessmann-Accounts können Sie eine `accounts.json` Datei im PVC ablegen:

```bash
# Pod Shell öffnen
kubectl exec -it deployment/vieventlog -- /bin/bash

# accounts.json erstellen (clientSecret wird automatisch gesetzt)
cat > /config/accounts.json <<EOF
{
  "accounts": {
    "user1@example.com": {
      "id": "user1@example.com",
      "name": "Haupthaus",
      "email": "user1@example.com",
      "password": "passwort1",
      "clientId": "client-id-1",
      "active": true
    }
  }
}
EOF

# Rechte setzen
chmod 600 /config/accounts.json

# Pod neu starten
kubectl rollout restart deployment/vieventlog
```

### Resources anpassen

In `deployment.yaml` können Sie die Resources anpassen:

```yaml
resources:
  limits:
    cpu: 500m
    memory: 256Mi
  requests:
    cpu: 100m
    memory: 128Mi
```

### Storage anpassen

In `pvc.yaml` können Sie die Storage-Größe oder Storage Class ändern:

```yaml
spec:
  storageClassName: fast-ssd  # Ihre Storage Class
  resources:
    requests:
      storage: 10Mi  # Nur für accounts.json Config-Datei
```

## Troubleshooting

### Pod startet nicht

```bash
kubectl describe pod -l app=vieventlog
kubectl logs -l app=vieventlog
```

### Secret fehlt

```bash
kubectl get secret vieventlog-secrets
kubectl describe secret vieventlog-secrets
```

### TLS Certificate wird nicht ausgestellt

```bash
# Certificate Status prüfen
kubectl describe certificate vieventlog-tls

# cert-manager Logs
kubectl logs -n cert-manager deployment/cert-manager

# Challenge prüfen
kubectl get challenges
kubectl describe challenge <challenge-name>
```

### Ingress funktioniert nicht

```bash
# Traefik Logs
kubectl logs -n kube-system deployment/traefik

# Ingress Details
kubectl describe ingress vieventlog
```

## Deinstallation

```bash
kubectl delete -f charts/vieventlog/

# Secret auch löschen
kubectl delete secret vieventlog-secrets

# PVC löschen (Achtung: Daten gehen verloren!)
kubectl delete pvc vieventlog-pvc
```

## Sicherheit

- **Secrets**: Niemals echte Credentials in YAML-Dateien committen
- **Basic Auth**: Aktivieren wenn der Service öffentlich erreichbar ist
- **TLS**: Let's Encrypt stellt automatisch gültige Zertifikate aus
- **Network Policies**: Optional können Sie Network Policies hinzufügen
- **RBAC**: Der Pod läuft als non-root User (UID 1000)

## Updates

```bash
# Neues Image Version deployen
kubectl set image deployment/vieventlog vieventlog=ghcr.io/mschneider82/vieventlog:v0.0.6

# Oder in deployment.yaml ändern und apply
kubectl apply -f charts/vieventlog/deployment.yaml

# Rollout Status
kubectl rollout status deployment/vieventlog
```

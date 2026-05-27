# Admin API Protection Requirements

## Overview

All routes under `/api/v1/admin/**` are **not protected at the application layer** in the current phase. There is no JWT authentication, API-key validation, or RBAC middleware applied to admin endpoints.

**This is a deliberate design decision for Phase 6**: the admin API is intended for internal/backend use only and MUST be protected at the **network / infrastructure layer** before any deployment to a non-closed environment.

---

## Risk Warning

> **CRITICAL**: Exposing `/api/v1/admin/**` to the public internet without network-level restrictions allows unauthenticated access to sensitive operational data including conversation histories, audit logs, customer leads, and knowledge-base management.

---

## Mandatory Deployment Prerequisites

At least **one** of the following network-level controls MUST be in place before deploying to any environment accessible outside a fully trusted local network:

| Control | Description |
|---------|-------------|
| **Intranet / VPN restriction** | Bind the admin API to an internal network interface; require VPN for access |
| **Reverse proxy IP allowlist** | Configure nginx/Caddy/Traefik to permit only known office/VPN CIDR ranges |
| **Kubernetes Ingress allowlist** | Use `nginx.ingress.kubernetes.io/whitelist-source-range` annotation |
| **Cloud firewall / Security Group** | Block port 443/80 for admin paths at the cloud provider level |

**Local development** and **fully air-gapped / closed environments** are the only exceptions where these controls may be omitted.

---

## Nginx Configuration Example

Restrict admin routes to an internal CIDR range (adjust as needed):

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    # ── Public API ────────────────────────────────────────────────────────────
    location /api/v1/ {
        proxy_pass http://backend:3000;
    }

    # ── Admin API — internal only ─────────────────────────────────────────────
    location /api/v1/admin/ {
        # Allow VPN / office CIDR ranges
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        # Add any additional trusted ranges here
        # allow 203.0.113.0/24;

        deny all;

        proxy_pass http://backend:3000;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## Kubernetes Ingress Example (nginx-ingress)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: chatbot-api-ingress
  annotations:
    kubernetes.io/ingress.class: nginx
    # Restrict admin paths to VPN / internal CIDR ranges
    nginx.ingress.kubernetes.io/configuration-snippet: |
      location ~* ^/api/v1/admin/ {
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        deny all;
      }
spec:
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: chatbot-backend
                port:
                  number: 3000
```

---

## Environment Notes

| Environment | Requirement |
|-------------|-------------|
| **Local development** | No restriction required — loopback only |
| **CI / test** | No restriction required — ephemeral, no external access |
| **Staging** | IP allowlist or VPN REQUIRED |
| **Production** | IP allowlist or VPN REQUIRED; consider dedicated admin service/port |

---

## Future Work (Deferred to Later Phase)

The following application-layer controls are planned for a later phase and are NOT implemented in Phase 6:

- **JWT authentication** on admin routes (`@UseGuards(JwtAuthGuard)`)
- **Role-based access control (RBAC)** with admin roles
- **Admin-specific API keys** with rotation policy
- **Rate limiting** on admin endpoints
- **Audit logging** of all admin write operations with actor identity

Until those controls are implemented, network-level isolation is the sole security boundary for admin routes.

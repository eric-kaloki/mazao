# Stage 1: Build the React Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app
# Copy package files and install dependencies
COPY client/package*.json ./
RUN npm ci
# Copy the rest of the frontend source and build
COPY client/ ./
RUN npm run build

# Stage 2: Build the Go Backend
FROM golang:1.22-alpine AS backend-builder
WORKDIR /app
# Install necessary build tools (make, git)
RUN apk add --no-cache make git

# Copy Go modules manifests and download dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the Go source code
COPY . .

# Copy the built React app from Stage 1 into the location expected by Go's embed.FS
COPY --from=frontend-builder /app/dist ./client/dist

# Build the monolithic Go binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o mazaoplus .

# Stage 3: Minimal Runtime Image
FROM alpine:latest
WORKDIR /app

# Add ca-certificates for secure HTTPS requests if needed in the future
RUN apk --no-cache add ca-certificates tzdata

# Copy the compiled binary from the backend-builder
COPY --from=backend-builder /app/mazaoplus .

# The app listens on PORT environment variable, defaults to 8080
ENV PORT=8080
EXPOSE 8080

# Run the binary
CMD ["./mazaoplus"]

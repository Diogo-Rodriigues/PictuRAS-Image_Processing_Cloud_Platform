# PictuRAS - Image Processing Cloud Platform

This repository contains the work developed for the **Requirements and Software Architectures** course of the Master's in Informatics Engineering at the **University of Minho**.

## Project Overview

The **PictuRAS** project is a web-based Image Processing as a Service (SaaS) platform designed for cloud environments. It allows users to perform various image processing operations, ranging from basic tools like resizing and binarization to advanced AI-driven features like OCR and object identification.

The project followed an incremental development cycle, starting from an existing base solution and evolving through requirements analysis, extension, and final implementation.

## Objectives and Project Rationale

The primary goal of this project was to analyze an existing software solution and propose meaningful extensions to its functionality, security, and scalability. The development was structured to simulate a real-world software evolution scenario, focusing on structured requirements engineering and architectural integrity.

The core of our contribution is documented in the following files:

- **`proposed_changes.pdf`**: This document serves as our **Requirements Extension Report**. It contains the initial improvements and new features we proposed for the PictuRAS application. It includes detailed functional and non-functional requirements (e.g., AI tools, payment methods), use cases, and UML diagrams (Use Case and Behavioral diagrams).

- **`changes_todo.pdf`**: Following the course methodology, the teaching staff selected a requirements document to be implemented by all groups. This file represents the **approved specification** that served as the definitive roadmap for the implementation phase.

- **`report.pdf`**: This is the **Final Implementation Report** . it documents the actual technical work performed, including justifications for architectural decisions, explanations of the implemented features, final diagrams, and a summary of the corrective maintenance tasks addressed during development.

---

## Development Phases

The project was organized into three main phases:

- **Phase 0 (Analysis):** Study of the base solution, identifying strengths, weaknesses, and current limitations.


- **Phase 1 (Requirements Extension):** Identification of new functional requirements (e.g., artistic styles, emotion detection) and non-functional requirements (e.g., parallel processing, monitoring).


- **Phase 2 (Implementation):** Full integration of the approved requirements into the existing PictuRAS codebase.

## Key Features Implemented

- **Real-Time Collaborative Editing (UC07):** Supports multiple users (owners and guests) collaborating on the same project simultaneously. Real-time synchronization is managed by a specialized WebSocket Gateway.

- **Concurrency Control (Auto-Lock):** Implements a transparent "Auto-Lock" mechanism that automatically assigns an exclusive session lock to a user when they attempt to modify a project, preventing data corruption from simultaneous edits.

- **Secure Project Sharing:** Users can share projects via unique secure links with specific permission levels, such as "View" or "Edit".

- **Link Management Dashboard:** A dedicated interface for project owners to manage active links, monitor shares, and immediately revoke access to ensure data security.

- **Asynchronous Processing & Cancellation:** Image processing is handled via a decoupled message-based system using RabbitMQ. It includes an asynchronous cancellation feature that allows users to halt processing pipelines immediately.

- **Scalable Microservices Architecture:** The system is composed of approximately 28 containers, including domain-specific microservices (projects, users, subscriptions) and specialized AI tools.

- **Centralized Infrastructure:** Uses an API Gateway to centralize access, validate permissions, and handle errors uniformly across the system.

## 🏗️ Architecture

PictuRAS is built using a microservices architecture with the following components:

### Frontend

- **Technology**: Next.js 15 with React 19, TypeScript, and Tailwind CSS
- **Port**: 3000
- **Features**: Modern, responsive UI with real-time updates

### Backend Services

- **API Gateway**: Central entry point for all API requests (Port: 8000)
- **User Service**: User authentication and management (Port: 10001)
- **Project Service**: Project and image processing orchestration (Port: 9002)
- **Subscription Service**: Payment and subscription management (Port: 11001)
- **Image Storage Service**: File upload and management (Port: 11000)
- **WebSocket Gateway**: Real-time communication (Port: 4000)

### Processing Tools

- **Background Removal AI**: Advanced background removal using AI models
- **Object Detection AI**: YOLO-based object detection and classification
- **People Detection AI**: Person detection and counting
- **Text Recognition AI**: OCR for text extraction
- **Image Enhancement AI**: AI-powered image quality improvements
- **Traditional Tools**: Brightness, contrast, saturation, resize, rotate, crop, binarization, border effects

### Infrastructure

- **Message Queue**: RabbitMQ for asynchronous processing
- **Database**: MongoDB instances for different services
- **Storage**: MinIO for object storage
- **Load Balancer**: Nginx for request routing
- **Monitoring**: ELK stack for logging and monitoring (optional)

## 🛠️ Quick Start

### Prerequisites

- Docker and Docker Compose
- At least 8GB RAM (recommended for AI tools)
- Modern web browser

### Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd picturas
   ```

2. **Start the application**

   ```bash
   docker compose up
   ```

3. **Access the application**
   - Frontend: http://localhost:8080
   - API Gateway: http://localhost:8000
   - MinIO Console: http://localhost:9090 (admin/admin123)
   - RabbitMQ Management: http://localhost:15672 (user/password)

### First Steps

1. Open your browser and navigate to http://localhost:8080
2. Create a new account or use the anonymous mode
3. Start a new project and upload your first image
4. Explore the various editing tools and AI features

## 🎯 Usage

### For Users

1. **Create Account**: Register for a free account or use anonymous mode
2. **Start Project**: Create a new project and upload images
3. **Edit Images**: Use the intuitive toolbar to apply various effects
4. **AI Features**: Leverage AI tools for smart enhancements
5. **Export Results**: Download processed images individually or as a batch

### For Developers

- The system uses a message queue architecture for scalable processing
- Each tool is containerized and can be scaled independently
- Real-time updates are provided via WebSocket connections
- All services are stateless and can be deployed across multiple instances

## 🔧 Configuration

### Environment Variables

- `JWT_SECRET_KEY`: Secret key for JWT token generation
- `FREE_DAILY_OP`: Daily operation limit for free users (default: 5)
- `MINIO_ROOT_USER`: MinIO storage username
- `MINIO_ROOT_PASSWORD`: MinIO storage password
- `RABBITMQ_USER`: Message queue username
- `RABBITMQ_PASS`: Message queue password

### Scaling

- Increase the number of tool instances in docker-compose.yaml
- Adjust resource limits based on your hardware capabilities
- Monitor processing queues through RabbitMQ management interface

## 📁 Project Structure

```
PictuRAS-Image_Processing_Cloud_Platform/
├── 📂 apiGateway/           # Central entry point for API requests (Node.js)
├── 📂 frontend/             # User interface application (Next.js/React)
├── 📂 imageStorageService/  # Service handling image upload/retrieval (Node.js)
├── 📂 projects/             # Service determining project logic (Node.js)
├── 📂 subscriptions/        # Service managing user plans/payments (Node.js)
├── 📂 users/                # Service for authentication & user profiles (Node.js)
├── 📂 wsGateway/            # WebSocket gateway for real-time updates
├── 📂 Tools/                # Independent microservices for image processing
│   ├── 📂 bg_remove_ai/     # Background removal (Python/AI)
│   ├── 📂 objects_ai/       # Object detection (Python/AI)
│   ├── ...                  # Various other single-purpose tools
├── 📂 minio/                # MinIO configuration and Dockerfile
├── 📂 nginx/                # Nginx load balancer configuration
├── 📂 rabbitMQ/             # RabbitMQ configuration
└── 📄 docker-compose.yaml   # Main orchestration file
```

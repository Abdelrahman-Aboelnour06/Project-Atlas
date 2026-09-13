# Use a lightweight Python image
FROM python:3.11-slim

# Set the working directory
WORKDIR /app

# Copy the requirements file and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire backend app directory
COPY ./app ./app

# Expose the FastAPI port
EXPOSE 8000

# Create non-root user and drop root privileges
RUN groupadd -r atlas && useradd -r -g atlas -u 10001 atlas
USER 10001

# Start the server
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
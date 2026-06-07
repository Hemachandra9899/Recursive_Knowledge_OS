FROM mcr.microsoft.com/playwright/python:v1.49.1-noble

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && scrapling install

COPY . .

EXPOSE 8100

CMD ["python", "run.py"]

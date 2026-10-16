
For docker, command: docker compose -f docker/docker-compose.yml up -d
docker restart when any changes done: docker compose -f docker/docker-compose.yml restart nginx
stop: docker compose -f docker/docker-compose.yml down


For cloudfare , command : .\cloudflared.exe tunnel --url https://localhost:443 --no-tls-verify 
it will generate a new link everytime (for diff networking calling )
if you want to use this for single network dont run cloudfare command run both in separate terminal/powershell

ngrok:
1- winget install ngrok -s msstore
2- Log in or create a free account at dashboard.ngrok.com.
    Copy your personal authtoken from the dashboard.
3- ngrok config add-authtoken YOUR_AUTHTOKEN_HERE
4- ngrok http https://localhost:443   (to generate the link)
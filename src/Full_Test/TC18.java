package Full_Test;

import org.junit.Assert;
import org.junit.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.Keys;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;

import java.util.HashMap;
import java.util.Map;

public class TC18 {

    private static WebDriver driver;

    @Test
    public void T18() throws InterruptedException {
        System.setProperty("webdriver.chrome.driver", "/Users/mk-mac-190/Documents/selenium/chromedriver");

        Map<String, String> mobileEmulation = new HashMap<>();

        mobileEmulation.put("deviceName", "Samsung Galaxy S20 Ultra");

        ChromeOptions chromeOptions = new ChromeOptions();

        chromeOptions.setExperimentalOption("mobileEmulation", mobileEmulation);

        WebDriver driver = new ChromeDriver(chromeOptions);


        // stg 접속
        driver.get("https://www.stg.kurly.com/member/login?return_url=/mypage");
        Thread.sleep(1500);

        // 현재창 핸들
        String winHandleBefore = driver.getWindowHandle();

        // 아이디 입력
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[3]/form/div[1]/div[1]/div/input")).sendKeys("webauto");
        Thread.sleep(500);

        // 패스워드 입력
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[3]/form/div[1]/div[2]/div/input")).sendKeys("qawsedrf12");
        Thread.sleep(500);

        // 로그인 버튼 클릭
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[3]/form/div[3]/button[1]")).click();
        Thread.sleep(1200);

        // 검색 탭
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[4]/a[3]")).click();
        Thread.sleep(500);

        // 키워드 입력
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[1]/div/div[3]/div/input")).click();
        Thread.sleep(1000);
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[1]/div/div/div/div/input")).sendKeys("첵스");
        Thread.sleep(1300);

        // 검색
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[1]/div/div/div/div/input")).sendKeys(Keys.ENTER);
        Thread.sleep(3000);

        //장바구니 담기
        driver.findElement(By.xpath("//*[@id=\"container\"]/div/div[2]/div[1]/div[1]/div/div/button")).click();
        Thread.sleep(500);
        driver.findElement(By.xpath("/html/body/div[2]/div[3]/div/div[3]/button[2]")).click();
        Thread.sleep(1000);

        // 장바구니 이동
        driver.findElement(By.xpath("//*[@id=\"swal2-content\"]/div[2]/button[1]")).click();
        Thread.sleep(3000);

        // 상품 장바구니 담김 확인
        Assert.assertEquals("[켈로그] 첵스 초코", driver.findElement(By.xpath("//*[@id=\"__next\"]/ul[2]/li[1]/div/div/a")).getText());
        System.out.println("상품 정상 담김 확인");
        Thread.sleep(1000);

        //전체 체크 해제
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[5]/div/label/img")).click();
        Thread.sleep(1000);

        //주문 상품 체크
        driver.findElement(By.xpath("//*[@id=\"__next\"]/ul[2]/li[1]/div/label/img")).click();
        Thread.sleep(1000);

        //상품 삭제 버튼 클릭
        driver.findElement(By.xpath("//*[@id=\"__next\"]/ul[2]/li[1]/div/button")).click();
        Thread.sleep(1000);

        //상품 삭제 얼럿 확인 클릭
        driver.findElement(By.xpath("//*[@id=\"swal2-content\"]/div[2]/button[2]")).click();
        Thread.sleep(1000);

        driver.close();

    }
}
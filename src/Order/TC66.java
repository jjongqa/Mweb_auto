package Order;

import org.junit.Assert;
import org.junit.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.Keys;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;

import java.util.Date;
import java.util.HashMap;
import java.util.Map;

public class TC66 {

    private static WebDriver driver;

    @Test
    public void TC66() throws InterruptedException {
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
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[3]/form/div[1]/div[1]/div/input")).sendKeys("webauto2");
        Thread.sleep(500);

        // 패스워드 입력
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[3]/form/div[1]/div[2]/div/input")).sendKeys("qawsedrf12");
        Thread.sleep(500);

        // 로그인 버튼 클릭
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[3]/form/div[3]/button[1]")).click();
        Thread.sleep(1500);

        // 장바구니 아이콘 클릭
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[1]/div/div/div[2]/button[2]")).click();
        Thread.sleep(3000);

        //주문하기 버튼 선택
        driver.findElement(By.xpath("//*[@id=\"__next\"]/footer/button")).click();
        Thread.sleep(3000);

        // 결제수단 신용카드 선택
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[9]/div/div[2]/button[1]")).click();
        Thread.sleep(500);

        // 결제 진행 필수 동의 항목 노출 확인

        // 개인정보 수집,이용 및 처리동의 팝업
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[13]/div/p[1]/span")).click();
        Thread.sleep(500);
        Assert.assertEquals("개인정보 수집·이용 및 처리 동의 (필수)", driver.findElement(By.xpath("/html/body/div[2]/div[3]/div/div[1]/div/div/h1")).getText());
        System.out.println("개인정보 수집,이용 및 처리동의 팝업 노출 확인");
        Thread.sleep(300);
        driver.findElement(By.xpath("/html/body/div[2]/div[3]/div/div[2]/button")).click();
        Thread.sleep(500);

        // 개인정보 제3자 제공 동의 팝업
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[13]/div/p[2]/span")).click();
        Thread.sleep(500);
        Assert.assertEquals("개인정보 제3자 제공 동의 (필수)", driver.findElement(By.xpath("/html/body/div[2]/div[3]/div/div[1]/div/div/h1")).getText());
        System.out.println("개인정보 제3자 제공 동의 팝업 노출 확인");
        Thread.sleep(300);
        driver.findElement(By.xpath("/html/body/div[2]/div[3]/div/div[2]/button")).click();
        Thread.sleep(500);

        // 결제대행 서비스 약관 동의 팝업
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[13]/div/p[3]/span")).click();
        Thread.sleep(500);
        Assert.assertEquals("토스페이먼츠 전자결제서비스 이용약관", driver.findElement(By.xpath("/html/body/div[2]/div[3]/div/div[1]/div/div/h1")).getText());
        System.out.println("결제대행 서비스 약관 동의 팝업 노출 확인");
        Thread.sleep(300);
        driver.findElement(By.xpath("/html/body/div[2]/div[3]/div/div[2]/button")).click();
        Thread.sleep(500);

        // 전자지급 결제대행 서비스 이용약관 동의 팝업
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[13]/div/p[4]/span")).click();
        Thread.sleep(500);
        Assert.assertEquals("컬리페이 전자지급 결제대행 서비스 이용약관", driver.findElement(By.xpath("/html/body/div[2]/div[3]/div/div[1]/div/div/h1")).getText());
        System.out.println("컬리페이 전자지급 결제대행 서비스 이용약관 팝업 노출 확인");
        Thread.sleep(300);
        driver.findElement(By.xpath("/html/body/div[2]/div[3]/div/div[2]/button")).click();
        Thread.sleep(500);

        // 디폴트 미체크되어 노출

        // 전체 동의 클릭 시 하위 항목 일괄 체크
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[13]/label/img")).click();
        Thread.sleep(500);

        // 개인정보 수집 이용 및 처리 동의 체크 활성 여부
        WebElement check1 = driver.findElement(By.xpath("//*[@id=\"__next\"]/div[13]/div/p[1]/label/img"));
        Boolean isEnable1 = check1.isEnabled();
        if (isEnable1 == true) {
            System.out.println("개인정보 수집,이용 및 처리동의 체크 활성화");
        }
        Thread.sleep(1000);

        // 개인정보 제3자 동의 체크 활성 여부
        WebElement check2 = driver.findElement(By.xpath("//*[@id=\"__next\"]/div[13]/div/p[2]/label/img"));
        Boolean isEnable2 = check2.isEnabled();
        if (isEnable2 == true) {
            System.out.println("개인정보 제3자 제공 동의 체크 활성화");
        }
        Thread.sleep(1000);

        // 결제대행 서비스 약관 동의 체크 활성 여부
        WebElement check3 = driver.findElement(By.xpath("//*[@id=\"__next\"]/div[13]/div/p[3]/label/img"));
        Boolean isEnable3 = check3.isEnabled();
        if (isEnable3 == true) {
            System.out.println("결제대행 서비스 약관 동의 체크 활성화");
        }
        Thread.sleep(1000);

        // 전자지급 결제대행 서비스 이용약관 동의 체크 활성 여부
        WebElement check4 = driver.findElement(By.xpath("//*[@id=\"__next\"]/div[13]/div/p[4]/label/img"));
        Boolean isEnable4 = check4.isEnabled();
        if (isEnable4 == true) {
            System.out.println("전자지급 결제대행 서비스 이용약관 동의 체크 활성화");
        }
        Thread.sleep(1000);

        // 일부 항목만 체크한 경우 전체 동의 체크 해제
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[13]/div/p[1]/label/img")).click();
        Thread.sleep(1000);

        WebElement check5 = driver.findElement(By.xpath("//*[@id=\"__next\"]/div[13]/label/img"));
        Boolean isEnable5 = check5.isEnabled();
        if (isEnable5 == false) {
        }
        System.out.println("전체동의 체크 비활성화");

        Thread.sleep(1000);

        //하위 항목을 모두 체크한 경우 전체 동의 체크
        driver.findElement(By.xpath("//*[@id=\"__next\"]/div[13]/div/p[1]/label/img")).click();
        Thread.sleep(1000);

        WebElement check6 = driver.findElement(By.xpath("//*[@id=\"__next\"]/div[13]/label/img"));
        Boolean isEnable6 = check6.isEnabled();
        if (isEnable6 == true) {
        }
        System.out.println("전체동의 체크 활성화");

        Thread.sleep(1000);


        driver.navigate().back();
        Thread.sleep(3000);


        // after

        driver.findElement(By.xpath("//*[@id=\"__next\"]/ul/li/div/button")).click();
        Thread.sleep(1000);
        driver.findElement(By.xpath("//*[@id=\"swal2-content\"]/div[2]/button[2]")).click();
        Thread.sleep(1000);

        driver.quit();

    }

}
